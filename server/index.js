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
 *   remote_input   { playerIndex, inputs }   (host only)
 *   game_state     state                     (non-host)
 *   player_left    { playerIndex }           (broadcast)
 *   promoted_to_host {}                      (new host, if previous left)
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

function makeCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function roomInfo(code) {
  const room = rooms.get(code);
  if (!room) return null;
  return {
    roomCode:    code,
    players:     room.players.map(p => ({ playerIndex: p.playerIndex, name: p.name || ('Jugador ' + (p.playerIndex + 1)) })),
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
  room.players = room.players.filter(p => p.socketId !== socket.id);
  socket.leave(code);

  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }

  if (room.host === socket.id) {
    room.host = room.players[0].socketId;
    io.to(room.host).emit('promoted_to_host', {});
  }

  io.to(code).emit('room_update', roomInfo(code));
}

// ── Socket handlers ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[+]', socket.id);

  // ── Create room ────────────────────────────────────────────────────────────
  socket.on('create_room', ({ name } = {}) => {
    leaveRoom(socket);

    let code;
    do { code = makeCode(); } while (rooms.has(code));

    const safeName = String(name || 'Jugador 1').slice(0, 12);
    rooms.set(code, {
      host:    socket.id,
      players: [{ socketId: socket.id, playerIndex: 0, name: safeName }],
      started: false,
    });

    socket.join(code);
    socket.emit('room_created', { roomCode: code, playerIndex: 0 });
    io.to(code).emit('room_update', roomInfo(code));
  });

  // ── Join room ──────────────────────────────────────────────────────────────
  socket.on('join_room', ({ roomCode, name }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room)              { socket.emit('room_error', 'Sala no encontrada'); return; }
    if (room.started)       { socket.emit('room_error', 'La partida ya comenzó'); return; }
    if (room.players.length >= 5) { socket.emit('room_error', 'Sala llena (máx 5 jugadores)'); return; }

    leaveRoom(socket);

    const playerIndex = room.players.length;
    const safeName = String(name || ('Jugador ' + (playerIndex + 1))).slice(0, 12);
    room.players.push({ socketId: socket.id, playerIndex, name: safeName });
    socket.join(code);
    socket.emit('room_joined', { roomCode: code, playerIndex });
    io.to(code).emit('room_update', roomInfo(code));
  });

  // ── Start game (host only) ─────────────────────────────────────────────────
  socket.on('start_game', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) { socket.emit('room_error', 'Se necesitan al menos 2 jugadores'); return; }

    room.started = true;
    const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    const playerNames = room.players.map(p => p.name || ('Jugador ' + (p.playerIndex + 1)));

    io.to(roomCode).emit('game_start', {
      playerCount: room.players.length,
      seed,
      playerNames,
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
