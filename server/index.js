/**
 * Bomberman – Relay Server
 * ========================
 * Pure relay: no game logic.  Manages rooms and passes messages between players.
 *
 * Protocol summary
 * ─────────────────
 * Client → Server:
 *   create_room                    → room_created | room_error
 *   join_room   { roomCode }       → room_joined  | room_error
 *   start_game  { roomCode }       → game_start broadcast (host only)
 *   return_to_lobby { roomCode }   → return_to_lobby broadcast (host only)
 *   update_name { roomCode, name }  → room_update broadcast
 *   player_input { roomCode, inputs }  → remote_input forwarded to host
 *   game_state  { roomCode, state }   → game_state broadcast to non-host players
 *   chat_msg    { roomCode, text }    → chat_msg broadcast
 *
 * Server → Client:
 *   room_created   { roomCode, playerIndex }
 *   room_joined    { roomCode, playerIndex }
 *   room_error     string
 *   room_update    { roomCode, players:[{playerIndex}], started }
 *   game_start     { playerCount, seed }     (broadcast)
 *   return_to_lobby { roomCode, players, playerCount } (broadcast)
 *   remote_input   { playerIndex, inputs }   (host only)
 *   game_state     state                     (non-host)
 *   player_left    { playerIndex }           (broadcast)
 *   host_left      {}                        (broadcast when host disconnects)
 *   chat_msg       { playerIndex, text }     (broadcast)
 */

const { createServer } = require('http');
const { Server }       = require('socket.io');

const httpServer = createServer((req, res) => {
  // Health-check endpoint
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  } else {
    res.writeHead(404); res.end();
  }
});

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 10000,
  pingTimeout:  5000,
});

// ── Room storage ──────────────────────────────────────────────────────────────
// Map<roomCode, { host: socketId, players: [{socketId, playerIndex}], started }>
const rooms = new Map();
const ALLOWED_CHARACTER_IDS = new Set(['wolf', 'bomby']);

function sanitizeName(name, fallback = 'Jugador') {
  const safe = String(name || '').trim().slice(0, 12);
  if (safe) return safe;
  return String(fallback || 'Jugador').trim().slice(0, 12) || 'Jugador';
}

function sanitizeCharacterId(characterId) {
  const id = String(characterId || '').trim().toLowerCase();
  return ALLOWED_CHARACTER_IDS.has(id) ? id : 'wolf';
}

function makeCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function roomInfo(code) {
  const room = rooms.get(code);
  if (!room) return null;
  return {
    roomCode:    code,
    players:     room.players.map(p => ({
      playerIndex: p.playerIndex,
      name: p.name || ('Jugador ' + (p.playerIndex + 1)),
      characterId: sanitizeCharacterId(p.characterId),
    })),
    playerCount: room.players.length,
    started:     room.started,
  };
}

function findRoomOf(socketId) {
  for (const [code, room] of rooms) {
    if (room.players.some(p => p.socketId === socketId)) return { code, room };
  }
  return null;
}

function leaveRoom(socket) {
  const r = findRoomOf(socket.id);
  if (!r) return;
  const { code, room } = r;
  const wasHost = room.host === socket.id;
  room.players = room.players.filter(p => p.socketId !== socket.id);
  socket.leave(code);

  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }

  if (wasHost) {
    // Host left — kick all remaining players and destroy room
    io.to(code).emit('host_left', {});
    for (const p of room.players) {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) s.leave(code);
    }
    rooms.delete(code);
    return;
  }

  io.to(code).emit('room_update', roomInfo(code));
}

// ── Socket handlers ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[+]', socket.id);

  // ── Create room ────────────────────────────────────────────────────────────
  socket.on('create_room', ({ name, characterId } = {}) => {
    leaveRoom(socket);

    let code;
    do { code = makeCode(); } while (rooms.has(code));

    const safeName = sanitizeName(name, 'Jugador 1');
    const safeCharacterId = sanitizeCharacterId(characterId);
    rooms.set(code, {
      host:    socket.id,
      players: [{
        socketId: socket.id,
        playerIndex: 0,
        name: safeName,
        characterId: safeCharacterId,
      }],
      started: false,
    });

    socket.join(code);
    socket.emit('room_created', { roomCode: code, playerIndex: 0 });
    io.to(code).emit('room_update', roomInfo(code));
  });

  // ── Join room ──────────────────────────────────────────────────────────────
  socket.on('join_room', ({ roomCode, name, characterId }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room)              { socket.emit('room_error', 'Sala no encontrada'); return; }
    if (room.started)       { socket.emit('room_error', 'La partida ya comenzó'); return; }
    if (room.players.length >= 5) { socket.emit('room_error', 'Sala llena (máx 5 jugadores)'); return; }

    leaveRoom(socket);

    const playerIndex = room.players.length;
    const safeName = sanitizeName(name, 'Jugador ' + (playerIndex + 1));
    const safeCharacterId = sanitizeCharacterId(characterId);
    room.players.push({
      socketId: socket.id,
      playerIndex,
      name: safeName,
      characterId: safeCharacterId,
    });
    socket.join(code);
    socket.emit('room_joined', { roomCode: code, playerIndex });
    io.to(code).emit('room_update', roomInfo(code));
  });

  // ── Start game (host only) ─────────────────────────────────────────────────
  socket.on('start_game', ({ roomCode, itemConfig }) => {
    const room = rooms.get(roomCode);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) { socket.emit('room_error', 'Se necesitan al menos 2 jugadores'); return; }

    room.started = true;
    const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    const playerProfiles = room.players.map(p => ({
      name: p.name || ('Jugador ' + (p.playerIndex + 1)),
      characterId: sanitizeCharacterId(p.characterId),
    }));
    const playerNames = playerProfiles.map(p => p.name);

    // Sanitise itemConfig: values must be non-negative integers, total capped at 30
    const safeConfig = {};
    let configTotal = 0;
    if (itemConfig && typeof itemConfig === 'object') {
      const ALLOWED = ['bomb_up', 'fire_up', 'speed_up', 'multi_bomb', 'kick', 'skull', 'rush'];
      for (const key of ALLOWED) {
        const v = Math.max(0, Math.min(30, Math.floor(Number(itemConfig[key]) || 0)));
        safeConfig[key] = v;
        configTotal += v;
      }
      // Enforce total cap
      if (configTotal > 30) {
        const scale = 30 / configTotal;
        for (const key of Object.keys(safeConfig)) {
          safeConfig[key] = Math.floor(safeConfig[key] * scale);
        }
      }
    }

    io.to(roomCode).emit('game_start', {
      playerCount: room.players.length,
      seed,
      playerNames,
      playerProfiles,
      itemConfig: safeConfig,
    });
  });

  // ── Host broadcasts game state → relay to everyone else ───────────────────
  socket.on('game_state', ({ roomCode, state }) => {
    socket.to(roomCode).emit('game_state', state);
  });

  // ── Client sends input → relay to host ────────────────────────────────────
  socket.on('player_input', ({ roomCode, inputs }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    io.to(room.host).emit('remote_input', { playerIndex: player.playerIndex, inputs });
  });

  // ── Return to lobby (host only) ──────────────────────────────────────────
  socket.on('return_to_lobby', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.host !== socket.id) return;
    room.started = false;
    io.to(roomCode).emit('return_to_lobby', roomInfo(roomCode));
  });

  // ── Update display name ────────────────────────────────────────────────
  socket.on('update_name', ({ roomCode, name } = {}) => {
    let code = String(roomCode || '').toUpperCase().trim();
    let room = code ? rooms.get(code) : null;
    if (!room) {
      const found = findRoomOf(socket.id);
      if (!found) return;
      code = found.code;
      room = found.room;
    }
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    const safeName = String(name || '').trim().slice(0, 12);
    if (!safeName) return;
    player.name = safeName;
    io.to(code).emit('room_update', roomInfo(code));
  });

  // ── Update full profile (name + character) ─────────────────────────────
  socket.on('update_profile', ({ roomCode, name, characterId } = {}) => {
    let code = String(roomCode || '').toUpperCase().trim();
    let room = code ? rooms.get(code) : null;
    if (!room) {
      const found = findRoomOf(socket.id);
      if (!found) return;
      code = found.code;
      room = found.room;
    }

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    let changed = false;
    const safeName = String(name || '').trim().slice(0, 12);
    if (safeName) {
      player.name = safeName;
      changed = true;
    }

    if (characterId !== undefined) {
      player.characterId = sanitizeCharacterId(characterId);
      changed = true;
    }

    if (!changed) return;
    io.to(code).emit('room_update', roomInfo(code));
  });

  // ── Chat ───────────────────────────────────────────────────────────────────
  socket.on('chat_msg', ({ roomCode, text }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    const safe = String(text).slice(0, 120);
    io.to(roomCode).emit('chat_msg', { playerIndex: player.playerIndex, text: safe });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log('[-]', socket.id);
    const r = findRoomOf(socket.id);
    if (r) {
      const idx = r.room.players.find(p => p.socketId === socket.id)?.playerIndex;
      leaveRoom(socket);
      if (idx !== undefined) {
        io.to(r.code).emit('player_left', { playerIndex: idx });
      }
    }
  });
});

const PORT = process.env.PORT || 3030;
httpServer.listen(PORT, () => console.log(`Bomberman relay server listening on :${PORT}`));
