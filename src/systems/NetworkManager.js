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

class NetworkManager {
  constructor() {
    this.socket      = null;
    this.roomCode    = null;
    this.playerIndex = -1;
    this.playerName  = '';
    this.isHost      = false;
    this.connected   = false;
    this._handlers   = {};
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
      this._emit('room_created', { roomCode, playerIndex });
    });

    s.on('room_joined', ({ roomCode, playerIndex }) => {
      this.roomCode    = roomCode;
      this.playerIndex = playerIndex;
      this.isHost      = false;
      this._emit('room_joined', { roomCode, playerIndex });
    });

    s.on('room_error',   msg           => this._emit('room_error', msg));
    s.on('room_update',  info          => this._emit('room_update', info));
    s.on('game_start',   data          => this._emit('game_start', data));
    s.on('game_state',   state         => this._emit('game_state', state));
    s.on('remote_input', data          => this._emit('remote_input', data));
    s.on('player_left',  data          => this._emit('player_left', data));
    s.on('chat_msg',     data          => this._emit('chat_msg', data));
    s.on('promoted_to_host', ()        => {
      this.isHost = true;
      this._emit('promoted_to_host', {});
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
  createRoom(name = '') {
    this._require();
    this.playerName = name;
    this.socket.emit('create_room', { name });
  }

  joinRoom(code, name = '') {
    this._require();
    this.playerName = name;
    this.socket.emit('join_room', { roomCode: code, name });
  }

  startGame() {
    this._require();
    this.socket.emit('start_game', { roomCode: this.roomCode });
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
    this.isHost      = false;
    this._handlers   = {};
  }

  _require() {
    if (!this.socket || !this.connected) throw new Error('Not connected');
  }
}

export const networkManager = new NetworkManager();
