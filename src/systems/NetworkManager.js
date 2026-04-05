/**
 * NetworkManager — wraps socket.io-client for the Bomberman online system.
 *
 * Usage:
 *   networkManager.connect(url)       → Promise<void>
 *   networkManager.createRoom()
 *   networkManager.joinRoom(code)
 *   networkManager.startGame()
 *   networkManager.sendInput(inputs)  // client → host
 *   networkManager.sendGameState(state) // host → all clients (via server)
 *   networkManager.on('event', cb)
 *   networkManager.disconnect()
 */
import { io } from 'socket.io-client';
import { DEFAULT_CHARACTER_ID } from '../data/constants.js';

class NetworkManager {
  constructor() {
    this.socket      = null;
    this.roomCode    = null;
    this.playerIndex = -1;
    this.playerName  = '';
    this.playerCharacterId = DEFAULT_CHARACTER_ID;
    this.clientId    = this._getOrCreateClientId();
    this.isHost      = false;
    this.connected   = false;
    this.lastPlayers = [];
    this._handlers   = {};
  }

  _makeClientId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `cid_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }

  _getOrCreateClientId() {
    const key = 'bomberman_client_id';
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const existing = String(window.localStorage.getItem(key) || '').trim();
        if (existing) return existing;
        const next = this._makeClientId();
        window.localStorage.setItem(key, next);
        return next;
      }
    } catch {
      // Ignore storage access issues and fallback to ephemeral id.
    }
    return this._makeClientId();
  }

  /**
   * Connect to the relay server.
   * @param {string} url  e.g. 'http://localhost:3030'
   * @returns {Promise<void>}
   */
  connect(url = 'http://localhost:3030') {
    if (this.socket) this.socket.disconnect();

    return new Promise((resolve, reject) => {
      const socket = io(url, {
        autoConnect:  true,
        reconnection: true,
        reconnectionAttempts: 3,
        timeout: 5000,
      });
      this.socket = socket;

      const onConnect = () => {
        this.connected = true;
        cleanup();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        socket.off('connect',       onConnect);
        socket.off('connect_error', onError);
      };

      socket.once('connect',       onConnect);
      socket.once('connect_error', onError);

      // Register persistent listeners
      this._register();
    });
  }

  _register() {
    const s = this.socket;

    s.on('room_created', ({ roomCode, playerIndex }) => {
      this.roomCode    = roomCode;
      this.playerIndex = playerIndex;
      this.isHost      = true;
      this.lastPlayers = [{
        playerIndex,
        name: this.playerName || ('Jugador 1'),
        characterId: this.playerCharacterId || DEFAULT_CHARACTER_ID,
        wins: 0,
      }];
      this._emit('room_created', { roomCode, playerIndex });
    });

    s.on('room_joined', ({ roomCode, playerIndex }) => {
      this.roomCode    = roomCode;
      this.playerIndex = playerIndex;
      this.isHost      = false;
      this._emit('room_joined', { roomCode, playerIndex });
    });

    s.on('room_error',   msg           => this._emit('room_error', msg));
    s.on('room_update',  info          => {
      let normalizedInfo = info;
      if (info.players) {
        this.lastPlayers = info.players.map(p => ({
          ...p,
          characterId: p.characterId || DEFAULT_CHARACTER_ID,
          wins: Number.isFinite(p.wins) ? p.wins : 0,
        }));
        normalizedInfo = {
          ...info,
          players: this.lastPlayers,
        };
        const me = info.players.find(p => p.playerIndex === this.playerIndex);
        if (me?.name) this.playerName = me.name;
        if (me?.characterId) this.playerCharacterId = me.characterId;
      }
      this._emit('room_update', normalizedInfo);
    });
    s.on('game_start',   data          => this._emit('game_start', data));
    s.on('game_state',   state         => this._emit('game_state', state));
    s.on('remote_input', data          => this._emit('remote_input', data));
    s.on('player_left',  data          => this._emit('player_left', data));
    s.on('chat_msg',     data          => this._emit('chat_msg', data));
    s.on('host_left',    ()            => this._emit('host_left', {}));
    s.on('return_to_lobby', data       => {
      if (data.players) {
        this.lastPlayers = data.players.map(p => ({
          ...p,
          characterId: p.characterId || DEFAULT_CHARACTER_ID,
          wins: Number.isFinite(p.wins) ? p.wins : 0,
        }));
      }
      this._emit('return_to_lobby', {
        ...data,
        players: data.players ? this.lastPlayers : data.players,
      });
    });
    s.on('disconnect', () => {
      this.connected = false;
      this._emit('disconnected', {});
    });
  }

  // ── Event emitter ──────────────────────────────────────────────────────────
  on(event, cb) {
    (this._handlers[event] = this._handlers[event] || []).push(cb);
    return () => this.off(event, cb); // returns unsubscribe function
  }

  off(event, cb) {
    if (!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter(h => h !== cb);
  }

  _emit(event, data) {
    (this._handlers[event] || []).forEach(h => h(data));
  }

  // ── Server actions ─────────────────────────────────────────────────────────
  createRoom(name = '', characterId = this.playerCharacterId) {
    this._require();
    const safeName = String(name || '').trim().slice(0, 12);
    const safeCharacterId = String(characterId || DEFAULT_CHARACTER_ID).trim().toLowerCase();
    this.playerName = safeName;
    this.playerCharacterId = safeCharacterId || DEFAULT_CHARACTER_ID;
    this.socket.emit('create_room', {
      name: safeName,
      characterId: this.playerCharacterId,
      clientId: this.clientId,
    });
  }

  joinRoom(code, name = '', characterId = this.playerCharacterId) {
    this._require();
    const safeName = String(name || '').trim().slice(0, 12);
    const safeCharacterId = String(characterId || DEFAULT_CHARACTER_ID).trim().toLowerCase();
    this.playerName = safeName;
    this.playerCharacterId = safeCharacterId || DEFAULT_CHARACTER_ID;
    this.socket.emit('join_room', {
      roomCode: code,
      name: safeName,
      characterId: this.playerCharacterId,
      clientId: this.clientId,
    });
  }

  startGame(itemConfig = {}) {
    this._require();
    this.socket.emit('start_game', { roomCode: this.roomCode, itemConfig });
  }

  returnToLobby({ winnerIndex = -1, winnerName = '' } = {}) {
    if (!this.socket || !this.roomCode) return;
    this.socket.emit('return_to_lobby', {
      roomCode: this.roomCode,
      winnerIndex,
      winnerName,
    });
  }

  updateName(name = '') {
    if (!this.socket || !this.connected) return;
    const safeName = String(name || '').trim().slice(0, 12);
    if (!safeName) return;
    this.playerName = safeName;
    this.socket.emit('update_name', { roomCode: this.roomCode || '', name: safeName });
  }

  updateProfile({ name, characterId } = {}) {
    if (!this.socket || !this.connected) return;
    const safeName = String(name || '').trim().slice(0, 12);
    const safeCharacterId = String(characterId || this.playerCharacterId || DEFAULT_CHARACTER_ID)
      .trim()
      .toLowerCase();

    if (safeName) this.playerName = safeName;
    this.playerCharacterId = safeCharacterId || DEFAULT_CHARACTER_ID;

    this.socket.emit('update_profile', {
      roomCode: this.roomCode || '',
      name: safeName,
      characterId: this.playerCharacterId,
    });
  }

  /** Host → all other clients (batched at 20hz by GameScene) */
  sendGameState(state) {
    if (!this.socket || !this.roomCode) return;
    this.socket.emit('game_state', { roomCode: this.roomCode, state });
  }

  /** Client → host (sent every frame when keys change) */
  sendInput(inputs) {
    if (!this.socket || !this.roomCode) return;
    this.socket.emit('player_input', { roomCode: this.roomCode, inputs });
  }

  sendChat(text) {
    if (!this.socket || !this.roomCode) return;
    this.socket.emit('chat_msg', { roomCode: this.roomCode, text });
  }

  disconnect() {
    if (this.socket) { this.socket.disconnect(); this.socket = null; }
    this.connected   = false;
    this.roomCode    = null;
    this.playerIndex = -1;
    this.playerName  = '';
    this.playerCharacterId = DEFAULT_CHARACTER_ID;
    this.isHost      = false;
    this.lastPlayers = [];
    this._handlers   = {};
  }

  _require() {
    if (!this.socket || !this.connected) throw new Error('Not connected');
  }
}

export const networkManager = new NetworkManager();
