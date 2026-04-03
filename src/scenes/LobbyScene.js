import { GAME_WIDTH, CANVAS_HEIGHT, PLAYER_COLORS } from '../data/constants.js';
import { networkManager } from '../systems/NetworkManager.js';

const W  = GAME_WIDTH;
const H  = CANVAS_HEIGHT;
const CX = W / 2;

export class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
    this._unsubs     = [];
    this._serverUrl  = import.meta.env.VITE_SERVER_URL || 'http://localhost:3030';
    this._joinCode   = '';
    this._playerName = 'Jugador';
    this._grpConnect = [];
    this._grpRole    = [];
    this._grpJoin    = [];
    this._grpRoom    = [];
    this._grpHost    = [];
    this._grpClient  = [];
    this._playerCards = [];
  }

  create() {
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0d001a, 0x0d001a, 0x001a30, 0x001a30, 1);
    bg.fillRect(0, 0, W, H);

    this.add.text(CX, 38, 'BOMBERMAN ONLINE', {
      fontSize: '30px', fontFamily: 'monospace',
      color: '#ffdd00', stroke: '#ff6600', strokeThickness: 5,
    }).setOrigin(0.5);

    this._status = this.add.text(CX, 74, '', {
      fontSize: '13px', fontFamily: 'monospace', color: '#aaddff',
    }).setOrigin(0.5);

    // ── Section: Connect ───────────────────────────────────────────────
    const lblName = this.add.text(CX, 96, 'Tu nombre', {
      fontSize: '11px', fontFamily: 'monospace', color: '#888888',
    }).setOrigin(0.5);
    this._grpConnect.push(lblName);

    this._nameDisplay = this.add.text(CX, 116, this._playerName, {
      fontSize: '15px', fontFamily: 'monospace', color: '#ffdd00',
      backgroundColor: '#1a1a3a', padding: { x: 14, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this._nameDisplay.on('pointerdown', () => {
      const v = window.prompt('Tu nombre (máx 12 caracteres):', this._playerName);
      if (v && v.trim()) {
        this._playerName = v.trim().slice(0, 12);
        this._nameDisplay.setText(this._playerName);
      }
    });
    this._grpConnect.push(this._nameDisplay);

    const lblSrv = this.add.text(CX, 148, 'Servidor', {
      fontSize: '11px', fontFamily: 'monospace', color: '#888888',
    }).setOrigin(0.5);
    this._grpConnect.push(lblSrv);

    this._urlDisplay = this.add.text(CX, 168, this._serverUrl, {
      fontSize: '13px', fontFamily: 'monospace', color: '#ffffff',
      backgroundColor: '#1a1a3a', padding: { x: 10, y: 5 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this._urlDisplay.on('pointerdown', () => {
      const v = window.prompt('URL del servidor:', this._serverUrl);
      if (v && v.trim()) { this._serverUrl = v.trim(); this._urlDisplay.setText(this._serverUrl); }
    });
    this._grpConnect.push(this._urlDisplay);

    this._btnConnect = this._makeBtn(CX, 203, 'CONECTAR', '#1a441a');
    this._btnConnect.on('pointerdown', () => this._doConnect());
    this._grpConnect.push(this._btnConnect);

    // ── Section: Role (hidden until connected) ────────────────────────
    const lblRole = this.add.text(CX, 192, '¿Cómo quieres jugar?', {
      fontSize: '18px', fontFamily: 'monospace', color: '#ffffff',
    }).setOrigin(0.5);
    this._grpRole.push(lblRole);

    const cardHost  = this._makeRoleCard(CX - 130, 278, 'ANFITRIÓN', 'Crea la sala y\ncomparte el código', '#0d3366', '#1a4488', '#88aaff');
    cardHost.zone.on('pointerdown', () => networkManager.createRoom(this._playerName));
    this._grpRole.push(...cardHost.parts);

    const cardGuest = this._makeRoleCard(CX + 130, 278, 'INVITADO', 'Entra con el código\nde un amigo', '#331166', '#551188', '#cc88ff');
    cardGuest.zone.on('pointerdown', () => {
      this._showGroup(this._grpJoin, true);
      this._setStatus('Escribe el código de sala y puls pulsa UNIRSE', '#aaddff');
    });
    this._grpRole.push(...cardGuest.parts);

    // ── Section: Join code (hidden until guest card clicked) ─────────
    const lblCode = this.add.text(CX, 350, 'Código de sala', {
      fontSize: '13px', fontFamily: 'monospace', color: '#aaaaaa',
    }).setOrigin(0.5);
    this._grpJoin.push(lblCode);

    this._codeInput = this.add.text(CX - 72, 373, '_ _ _ _ _', {
      fontSize: '22px', fontFamily: 'monospace', color: '#ffdd00',
      backgroundColor: '#1a1a3a', padding: { x: 12, y: 6 },
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    this._codeInput.on('pointerdown', () => {
      const v = window.prompt('Código de sala (5 letras):');
      if (v) {
        this._joinCode = v.toUpperCase().trim().slice(0, 5);
        this._codeInput.setText(this._joinCode || '_ _ _ _ _');
      }
    });
    this._grpJoin.push(this._codeInput);

    const btnJoin = this._makeBtn(CX + 84, 373, 'UNIRSE', '#661a0d');
    btnJoin.on('pointerdown', () => {
      if (this._joinCode.length >= 3) networkManager.joinRoom(this._joinCode, this._playerName);
      else this._setStatus('Escribe el código primero', '#ff8866');
    });
    this._grpJoin.push(btnJoin);

    // ── Section: Room info ─────────────────────────────────────────────
    const div1 = this.add.graphics();
    div1.lineStyle(1, 0x334466); div1.lineBetween(50, 340, W - 50, 340);
    this._grpRoom.push(div1);

    const lblSala = this.add.text(CX, 356, 'CÓDIGO DE SALA', {
      fontSize: '11px', fontFamily: 'monospace', color: '#666699',
    }).setOrigin(0.5);
    this._grpRoom.push(lblSala);

    this._roomCodeBig = this.add.text(CX, 388, '', {
      fontSize: '46px', fontFamily: 'monospace',
      color: '#ffdd00', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);
    this._grpRoom.push(this._roomCodeBig);

    this._shareHint = this.add.text(CX, 422, '', {
      fontSize: '11px', fontFamily: 'monospace', color: '#556688',
    }).setOrigin(0.5);
    this._grpRoom.push(this._shareHint);

    const lblPlayers = this.add.text(CX, 444, 'Jugadores en la sala:', {
      fontSize: '11px', fontFamily: 'monospace', color: '#888888',
    }).setOrigin(0.5);
    this._grpRoom.push(lblPlayers);

    // ── Section: Action ────────────────────────────────────────────────
    this._btnStart = this._makeBtn(CX, H - 78, '▶  CONFIGURAR ITEMS', '#2a4a88');
    this._btnStart.on('pointerdown', () => {
      this._cleanup();
      this.scene.start('ItemConfigScene');
    });
    this._grpHost.push(this._btnStart);

    this._waitMsg = this.add.text(CX, H - 78, 'Esperando al anfitrión para comenzar...', {
      fontSize: '14px', fontFamily: 'monospace', color: '#888888',
    }).setOrigin(0.5);
    this._grpClient.push(this._waitMsg);

    // ── Back ───────────────────────────────────────────────────────────
    const back = this.add.text(CX, H - 22, '← Menú principal', {
      fontSize: '12px', fontFamily: 'monospace', color: '#555555',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    back.on('pointerover', () => back.setStyle({ color: '#ffffff' }));
    back.on('pointerout',  () => back.setStyle({ color: '#555555' }));
    back.on('pointerdown', () => {
      networkManager.disconnect(); this._cleanup(); this.scene.start('MenuScene');
    });

    // Initially hide everything except connect
    this._showGroup(this._grpRole,   false);
    this._showGroup(this._grpJoin,   false);
    this._showGroup(this._grpRoom,   false);
    this._showGroup(this._grpHost,   false);
    this._showGroup(this._grpClient, false);

    this._setStatus('Introduce la URL del servidor y pulsa CONECTAR');
    this._registerListeners();
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  _makeBtn(x, y, label, bg) {
    const t = this.add.text(x, y, label, {
      fontSize: '14px', fontFamily: 'monospace',
      color: '#ffffff', backgroundColor: bg,
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setAlpha(0.75));
    t.on('pointerout',  () => t.setAlpha(1));
    return t;
  }

  _makeRoleCard(x, y, title, desc, bgNorm, bgHover, accentColor) {
    const cw = 210, ch = 108, r = 12;
    const bx = x - cw / 2, by = y - ch / 2;
    const g = this.add.graphics();
    const draw = (col) => {
      g.clear();
      g.fillStyle(parseInt(col.replace('#',''), 16), 0.95);
      g.fillRoundedRect(bx, by, cw, ch, r);
      g.lineStyle(2, parseInt(accentColor.replace('#',''), 16), 0.6);
      g.strokeRoundedRect(bx, by, cw, ch, r);
    };
    draw(bgNorm);

    const titleTxt = this.add.text(x, y - 18, title, {
      fontSize: '20px', fontFamily: 'monospace', color: accentColor, fontStyle: 'bold',
    }).setOrigin(0.5);
    const descTxt = this.add.text(x, y + 22, desc, {
      fontSize: '11px', fontFamily: 'monospace', color: '#cccccc', align: 'center',
    }).setOrigin(0.5);

    const zone = this.add.zone(x, y, cw, ch).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => draw(bgHover));
    zone.on('pointerout',  () => draw(bgNorm));

    return { zone, parts: [g, titleTxt, descTxt, zone] };
  }

  _showGroup(arr, visible) { arr.forEach(o => o && o.setVisible(visible)); }
  _setStatus(msg, color = '#aaddff') { this._status.setText(msg).setStyle({ color }); }

  _rebuildPlayerCards(players) {
    this._playerCards.forEach(o => o && o.destroy && o.destroy());
    this._playerCards = [];
    const cw = 66, gap = 6, total = players.length;
    let sx = CX - (total * cw + (total - 1) * gap) / 2 + cw / 2;
    players.forEach(({ playerIndex, name }) => {
      const pc       = PLAYER_COLORS[playerIndex];
      const dispName = (name || ('P' + (playerIndex + 1))).slice(0, 8);
      const g  = this.add.graphics();
      g.fillStyle(pc.shadow, 0.8);
      g.fillRoundedRect(sx - cw/2 + 2, 458, cw, 44, 5);
      g.fillStyle(pc.main, 0.9);
      g.fillRoundedRect(sx - cw/2, 456, cw, 44, 5);
      const lbl = this.add.text(sx, 468, dispName, {
        fontSize: '11px', fontFamily: 'monospace', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5);
      const idx = this.add.text(sx, 486, 'P' + (playerIndex + 1), {
        fontSize: '9px', fontFamily: 'monospace', color: '#aaaaaa',
      }).setOrigin(0.5);
      const me = playerIndex === networkManager.playerIndex
        ? this.add.text(sx, 496, '★TÚ', { fontSize: '9px', fontFamily: 'monospace', color: '#ffdd00' }).setOrigin(0.5)
        : null;
      this._playerCards.push(g, lbl, idx);
      if (me) this._playerCards.push(me);
      sx += cw + gap;
    });
  }

  // ── Network ────────────────────────────────────────────────────────────

  async _doConnect() {
    this._setStatus('Conectando a ' + this._serverUrl + '...');
    this._btnConnect.setAlpha(0.5);
    try {
      await networkManager.connect(this._serverUrl);
      this._showGroup(this._grpConnect, false);
      this._showGroup(this._grpRole,    true);
      this._setStatus('Conectado  —  ¿eres anfitrion o invitado?', '#88ff88');
    } catch {
      this._setStatus('No se pudo conectar. ¿Está el servidor en marcha?', '#ff6666');
    }
    this._btnConnect.setAlpha(1);
  }

  _registerListeners() {
    this._unsubs.push(
      networkManager.on('room_created', ({ roomCode }) => {
        this._roomCodeBig.setText(roomCode);
        this._shareHint.setText('Comparte este código con tus amigos');
        this._showGroup(this._grpRole,   false);
        this._showGroup(this._grpRoom,   true);
        this._showGroup(this._grpHost,   true);
        this._showGroup(this._grpClient, false);
        this._btnStart.setAlpha(0.4);
        this._setStatus('Sala creada. Esperando jugadores...', '#88ff88');
      }),
      networkManager.on('room_joined', ({ roomCode }) => {
        this._roomCodeBig.setText(roomCode);
        this._shareHint.setText('');
        this._showGroup(this._grpRole,   false);
        this._showGroup(this._grpJoin,   false);
        this._showGroup(this._grpRoom,   true);
        this._showGroup(this._grpHost,   false);
        this._showGroup(this._grpClient, true);
        this._setStatus('Unido a la sala ' + roomCode + '. Esperando al anfitrión...', '#88ff88');
      }),
      networkManager.on('room_error', msg => this._setStatus('✗ ' + msg, '#ff8866')),
      networkManager.on('room_update', ({ players, playerCount, roomCode }) => {
        this._rebuildPlayerCards(players);
        if (networkManager.isHost) {
          const ok = playerCount >= 2;
          this._btnStart.setAlpha(ok ? 1 : 0.4);
          this._setStatus('Sala ' + roomCode + ' — ' + playerCount + ' jugador(es).' + (ok ? ' ¡Listo!' : ' Falta al menos 1 más.'), '#aaddff');
        } else {
          this._setStatus('Sala ' + roomCode + ' — ' + playerCount + ' jugador(es). Esperando al anfitrión...', '#aaddff');
        }
      }),
      networkManager.on('promoted_to_host', () => {
        this._showGroup(this._grpHost,   true);
        this._showGroup(this._grpClient, false);
        this._setStatus('¡Ahora eres el anfitrión!', '#ffdd00');
      }),
      networkManager.on('player_left', ({ playerIndex }) => {
        this._setStatus('P' + (playerIndex + 1) + ' abandonó la sala', '#ffaa88');
      }),
      networkManager.on('game_start', ({ playerCount, seed, playerNames, itemConfig }) => {
        this._cleanup();
        this.scene.start('GameScene', {
          playerCount, online: true,
          isHost: networkManager.isHost,
          myPlayerIndex: networkManager.playerIndex,
          roomCode: networkManager.roomCode,
          seed, playerNames, itemConfig,
        });
      }),
      networkManager.on('disconnected', () => {
        this._setStatus('Desconectado del servidor', '#ff6666');
        this._showGroup(this._grpRole,    false);
        this._showGroup(this._grpJoin,    false);
        this._showGroup(this._grpRoom,    false);
        this._showGroup(this._grpHost,    false);
        this._showGroup(this._grpClient,  false);
        this._showGroup(this._grpConnect, true);
        this._playerCards.forEach(o => o && o.destroy && o.destroy());
        this._playerCards = [];
      }),
    );
  }

  _cleanup() { this._unsubs.forEach(u => u()); this._unsubs = []; }
}
