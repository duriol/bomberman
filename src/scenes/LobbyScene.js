import {
  GAME_WIDTH,
  CANVAS_HEIGHT,
  PLAYER_COLORS,
  CHARACTER_DEFS,
  CHARACTER_IDS,
  DEFAULT_CHARACTER_ID,
} from '../data/constants.js';
import { networkManager } from '../systems/NetworkManager.js';
import { preloadCharacterSets, normalizeCharacterId } from '../utils/CharacterAssets.js';

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
    this._roomCodeRaw = '';
    this._copyResetEvent = null;
    this._playersCountText = null;
    this._playersListHint = null;
    this._selectedCharacterId = networkManager.playerCharacterId || DEFAULT_CHARACTER_ID;
    this._editModal = null;
    this._editNameDraft = '';
    this._editCharacterDraft = DEFAULT_CHARACTER_ID;
  }

  init(data) {
    this._returningRoom = (data && data.returning) ? data.roomData : null;
    // Reset group arrays so create() builds fresh lists each time
    this._grpConnect = [];
    this._grpRole    = [];
    this._grpJoin    = [];
    this._grpRoom    = [];
    this._grpHost    = [];
    this._grpClient  = [];
    this._playerCards = [];
    this._unsubs     = [];
    this._roomCodeRaw = '';
    this._copyResetEvent = null;
    this._playersCountText = null;
    this._playersListHint = null;
    this._selectedCharacterId = networkManager.playerCharacterId || DEFAULT_CHARACTER_ID;
    this._editModal = null;
    this._editNameDraft = '';
    this._editCharacterDraft = this._selectedCharacterId;
  }

  preload() {
    preloadCharacterSets(this);
  }

  create() {
    this._drawBackground();

    this.add.text(CX, 34, 'BOMBERMAN ONLINE HUB', {
      fontSize: '33px', fontFamily: 'monospace',
      color: '#9af4ff', stroke: '#0a3142', strokeThickness: 6,
    }).setOrigin(0.5);

    this.add.text(CX, 60, 'ONLINE PRIORITARIO  |  CREA SALA O UNETE CON CODIGO', {
      fontSize: '11px', fontFamily: 'monospace', color: '#45ffcb',
      backgroundColor: '#0c2130', padding: { x: 8, y: 3 },
    }).setOrigin(0.5);

    this._status = this.add.text(CX, 80, '', {
      fontSize: '13px', fontFamily: 'monospace', color: '#c9ecff',
      backgroundColor: '#10273b', padding: { x: 10, y: 4 },
    }).setOrigin(0.5);

    // Visual panel guides
    this._grpConnect.push(...this._drawPanel(CX, 156, 590, 128, 0x091d2f, 0x2cb6e1));
    this._grpRole.push(...this._drawPanel(CX, 282, 620, 150, 0x0b1a2e, 0x5874ad));
    this._grpRoom.push(...this._drawPanel(CX, 432, 620, 216, 0x111822, 0x39b7d5));

    // ── Section: Connect ───────────────────────────────────────────────
    const lblName = this.add.text(CX, 98, 'IDENTIDAD', {
      fontSize: '10px', fontFamily: 'monospace', color: '#6b95ad',
    }).setOrigin(0.5);
    this._grpConnect.push(lblName);

    this._nameDisplay = this.add.text(CX, 116, this._playerName, {
      fontSize: '15px', fontFamily: 'monospace', color: '#f5fcff',
      backgroundColor: '#123047', padding: { x: 14, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this._nameDisplay.on('pointerdown', () => {
      const v = window.prompt('Tu nombre (max 12 caracteres):', this._playerName);
      if (v && v.trim()) {
        this._playerName = v.trim().slice(0, 12);
        this._nameDisplay.setText(this._playerName);
      }
    });
    this._grpConnect.push(this._nameDisplay);

    const lblSrv = this.add.text(CX, 148, 'RELAY SERVER', {
      fontSize: '10px', fontFamily: 'monospace', color: '#6b95ad',
    }).setOrigin(0.5);
    this._grpConnect.push(lblSrv);

    this._urlDisplay = this.add.text(CX, 168, this._serverUrl, {
      fontSize: '13px', fontFamily: 'monospace', color: '#e9f8ff',
      backgroundColor: '#123047', padding: { x: 10, y: 5 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this._urlDisplay.on('pointerdown', () => {
      const v = window.prompt('URL del servidor:', this._serverUrl);
      if (v && v.trim()) { this._serverUrl = v.trim(); this._urlDisplay.setText(this._serverUrl); }
    });
    this._grpConnect.push(this._urlDisplay);

    this._btnConnect = this._makeBtn(CX, 203, 'CONECTAR', '#14533f', '#1f7b5d');
    this._btnConnect.on('pointerdown', () => this._doConnect());
    this._grpConnect.push(this._btnConnect);

    // ── Section: Role (hidden until connected) ────────────────────────
    const lblRole = this.add.text(CX, 202, 'SELECCIONA TU ROL EN LA SALA', {
      fontSize: '16px', fontFamily: 'monospace', color: '#d5ebff',
    }).setOrigin(0.5);
    this._grpRole.push(lblRole);

    const cardHost  = this._makeRoleCard(CX - 130, 282, 'ANFITRION', 'Crea sala y comparte codigo\n(recomendado)', '#0f3146', '#155575', '#8feeff');
    cardHost.zone.on('pointerdown', () => networkManager.createRoom(this._playerName, this._selectedCharacterId));
    this._grpRole.push(...cardHost.parts);

    const cardGuest = this._makeRoleCard(CX + 130, 282, 'INVITADO', 'Unete con codigo\nde un amigo', '#2e2335', '#4b3358', '#ffc88b');
    cardGuest.zone.on('pointerdown', () => {
      this._showGroup(this._grpJoin, true);
      this._setStatus('Escribe el codigo de sala y pulsa UNIRSE', '#aaddff');
    });
    this._grpRole.push(...cardGuest.parts);

    // ── Section: Join code (hidden until guest card clicked) ─────────
    const lblCode = this.add.text(CX, 350, 'Código de sala', {
      fontSize: '12px', fontFamily: 'monospace', color: '#7fa7bf',
    }).setOrigin(0.5);
    this._grpJoin.push(lblCode);

    const joinFrame = this.add.graphics();
    joinFrame.fillStyle(0x13283f, 0.95);
    joinFrame.fillRoundedRect(CX - 154, 360, 308, 44, 8);
    joinFrame.lineStyle(2, 0x2d9dc0, 0.8);
    joinFrame.strokeRoundedRect(CX - 154, 360, 308, 44, 8);
    this._grpJoin.push(joinFrame);

    this._codeInput = this.add.text(CX, 382, '_ _ _ _ _', {
      fontSize: '26px', fontFamily: 'monospace', color: '#9ef8ff',
      stroke: '#072130', strokeThickness: 3,
    }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    this._codeInput.on('pointerdown', () => {
      const v = window.prompt('Código de sala (5 letras):');
      if (v) this._setJoinCodeDisplay(v);
    });
    this._grpJoin.push(this._codeInput);
    this._setJoinCodeDisplay('');

    const joinHelp = this.add.text(CX, 410, 'Toca el campo para escribir o pegar el codigo de 5 caracteres', {
      fontSize: '10px', fontFamily: 'monospace', color: '#7fa7bf',
    }).setOrigin(0.5);
    this._grpJoin.push(joinHelp);

    const btnJoin = this._makeBtn(CX, 434, 'UNIRSE A LA SALA', '#5c3414', '#845226');
    btnJoin.on('pointerdown', () => {
      if (this._joinCode.length === 5) networkManager.joinRoom(this._joinCode, this._playerName, this._selectedCharacterId);
      else this._setStatus('El codigo debe tener 5 caracteres', '#ff8866');
    });
    this._grpJoin.push(btnJoin);

    // ── Section: Room info ─────────────────────────────────────────────
    const topPlayersBand = this.add.graphics();
    topPlayersBand.fillStyle(0x0f1f31, 0.92);
    topPlayersBand.fillRoundedRect(CX - 286, 92, 572, 204, 10);
    topPlayersBand.lineStyle(2, 0x2b7a9d, 0.7);
    topPlayersBand.strokeRoundedRect(CX - 286, 92, 572, 204, 10);
    this._grpRoom.push(topPlayersBand);

    const lblPlayersTop = this.add.text(CX - 266, 109, 'JUGADORES CONECTADOS', {
      fontSize: '12px', fontFamily: 'monospace', color: '#9fdcff',
    }).setOrigin(0, 0.5);
    this._grpRoom.push(lblPlayersTop);

    this._playersCountText = this.add.text(CX + 266, 109, '0/5 ONLINE', {
      fontSize: '10px', fontFamily: 'monospace', color: '#8ff6ff',
      backgroundColor: '#15354a', padding: { x: 6, y: 3 },
    }).setOrigin(1, 0.5);
    this._grpRoom.push(this._playersCountText);

    this._playersListHint = this.add.text(CX, 130, 'Lista en vivo - pulsa EDITAR en tu fila para nombre y personaje', {
      fontSize: '10px', fontFamily: 'monospace', color: '#7fa7bf',
    }).setOrigin(0.5);
    this._grpRoom.push(this._playersListHint);

    const div1 = this.add.graphics();
    div1.lineStyle(1, 0x2b7a9d);
    div1.lineBetween(60, 340, W - 60, 340);
    this._grpRoom.push(div1);

    const lblSala = this.add.text(CX, 356, 'CODIGO DE SALA', {
      fontSize: '11px', fontFamily: 'monospace', color: '#75a8c4',
    }).setOrigin(0.5);
    this._grpRoom.push(lblSala);

    this._roomCodeBig = this.add.text(CX, 388, '', {
      fontSize: '46px', fontFamily: 'monospace',
      color: '#9af4ff', stroke: '#092538', strokeThickness: 4,
    }).setOrigin(0.5);
    this._grpRoom.push(this._roomCodeBig);

    this._btnCopyCode = this._makeBtn(CX, 424, 'COPIAR CODIGO', '#0f5a66', '#1f8ea2');
    this._btnCopyCode.on('pointerdown', () => this._copyRoomCode());
    this._grpRoom.push(this._btnCopyCode);

    this._shareHint = this.add.text(CX, 448, '', {
      fontSize: '11px', fontFamily: 'monospace', color: '#6e8fa2',
    }).setOrigin(0.5);
    this._grpRoom.push(this._shareHint);

    const lblPlayers = this.add.text(CX, 468, 'Jugadores en la sala:', {
      fontSize: '11px', fontFamily: 'monospace', color: '#8ca8b7',
    }).setOrigin(0.5);
    lblPlayers.setVisible(false);

    // ── Section: Action ────────────────────────────────────────────────
    this._btnStart = this._makeBtn(CX, H - 78, 'CONFIGURAR ITEMS', '#1c617b', '#2f8fb2');
    this._btnStart.on('pointerdown', () => {
      this._cleanup();
      this.scene.start('ItemConfigScene');
    });
    this._grpHost.push(this._btnStart);

    this._waitMsg = this.add.text(CX, H - 78, 'Esperando al anfitrión para comenzar...', {
      fontSize: '14px', fontFamily: 'monospace', color: '#9cb0bf',
    }).setOrigin(0.5);
    this._grpClient.push(this._waitMsg);

    // ── Back ───────────────────────────────────────────────────────────
    const back = this.add.text(CX, H - 22, '← Menú principal', {
      fontSize: '12px', fontFamily: 'monospace', color: '#567386',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    back.on('pointerover', () => back.setStyle({ color: '#ffffff' }));
    back.on('pointerout',  () => back.setStyle({ color: '#567386' }));
    back.on('pointerdown', () => {
      networkManager.disconnect(); this._cleanup(); this.scene.start('MenuScene');
    });

    // Initially hide everything except connect
    this._showGroup(this._grpRole,   false);
    this._showGroup(this._grpJoin,   false);
    this._showGroup(this._grpRoom,   false);
    this._showGroup(this._grpHost,   false);
    this._showGroup(this._grpClient, false);

    this._registerListeners();

    // ── If already connected and in a room (returning from game or ItemConfig) ──
    if (networkManager.connected && networkManager.roomCode) {
      this._showGroup(this._grpConnect, false);
      this._showGroup(this._grpRole,    false);
      this._showGroup(this._grpRoom,    true);
      this._setRoomCode(networkManager.roomCode);
      if (networkManager.isHost) {
        this._shareHint.setText('Comparte este c\u00f3digo con tus amigos');
        this._showGroup(this._grpHost,   true);
        this._showGroup(this._grpClient, false);
        const cnt = networkManager.lastPlayers.length;
        this._btnStart.setAlpha(cnt >= 2 ? 1 : 0.4);
        this._setStatus('De vuelta en el lobby \u2014 \u00bfJugamos otra vez?', '#88ff88');
      } else {
        this._shareHint.setText('');
        this._showGroup(this._grpHost,   false);
        this._showGroup(this._grpClient, true);
        this._setStatus('De vuelta en el lobby. Esperando al anfitri\u00f3n...', '#88ff88');
      }
      this._rebuildPlayerCards(networkManager.lastPlayers);
    } else {
      this._showGroup(this._grpConnect, true);
      this._setStatus('Introduce la URL del servidor y pulsa CONECTAR');
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  _drawBackground() {
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x041220, 0x041220, 0x0b2134, 0x0b2134, 1);
    bg.fillRect(0, 0, W, H);

    const grid = this.add.graphics();
    grid.lineStyle(1, 0x18455e, 0.32);
    for (let x = 0; x <= W; x += 36) grid.lineBetween(x, 0, x, H);
    for (let y = 0; y <= H; y += 36) grid.lineBetween(0, y, W, y);

    const glow = this.add.graphics();
    glow.fillStyle(0x1fd7ff, 0.08);
    glow.fillCircle(120, 120, 140);
    glow.fillStyle(0x11ffb2, 0.07);
    glow.fillCircle(W - 120, H - 120, 170);

    const scan = this.add.rectangle(-90, 0, 90, H, 0x6cf6ff, 0.06)
      .setOrigin(0, 0)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: scan,
      x: W + 110,
      duration: 5600,
      ease: 'Linear',
      repeat: -1,
    });
  }

  _drawPanel(cx, cy, w, h, fill, border) {
    const x = cx - w / 2;
    const y = cy - h / 2;
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.35);
    shadow.fillRoundedRect(x + 4, y + 4, w, h, 12);
    const panel = this.add.graphics();
    panel.fillStyle(fill, 0.9);
    panel.fillRoundedRect(x, y, w, h, 12);
    panel.lineStyle(2, border, 0.65);
    panel.strokeRoundedRect(x, y, w, h, 12);
    return [shadow, panel];
  }

  _makeBtn(x, y, label, bg, hoverBg = '#2b6e8d') {
    const t = this.add.text(x, y, label, {
      fontSize: '14px', fontFamily: 'monospace',
      color: '#ffffff', backgroundColor: bg,
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    t._normalBg = bg;
    t._hoverBg = hoverBg;
    t.on('pointerover', () => {
      t.setStyle({ backgroundColor: hoverBg });
      this.tweens.add({ targets: t, scale: 1.03, duration: 80 });
    });
    t.on('pointerout',  () => {
      t.setStyle({ backgroundColor: bg });
      this.tweens.add({ targets: t, scale: 1.0, duration: 80 });
    });
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
      g.lineStyle(1, parseInt(accentColor.replace('#',''), 16), 0.35);
      g.strokeRoundedRect(bx + 6, by + 6, cw - 12, ch - 12, r - 4);
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

  _setJoinCodeDisplay(code) {
    const raw = String(code || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 5);
    this._joinCode = raw;
    if (!this._codeInput) return;
    const shown = (raw.padEnd(5, '_')).split('').join(' ');
    this._codeInput.setText(shown);
  }

  _askRename() {
    this._openEditModal();
  }

  _openEditModal() {
    this._closeEditModal();

    this._editNameDraft = String(this._playerName || ('Jugador ' + (networkManager.playerIndex + 1))).slice(0, 12);
    this._editCharacterDraft = normalizeCharacterId(this._selectedCharacterId || DEFAULT_CHARACTER_ID);

    const parts = [];
    const cards = new Map();

    const dim = this.add.graphics().setDepth(300);
    dim.fillStyle(0x000000, 0.72);
    dim.fillRect(0, 0, W, H);
    parts.push(dim);

    const panelW = 610;
    const panelH = 390;
    const px = CX - panelW / 2;
    const py = H / 2 - panelH / 2;

    const panel = this.add.graphics().setDepth(301);
    panel.fillStyle(0x0b1f34, 0.98);
    panel.fillRoundedRect(px, py, panelW, panelH, 12);
    panel.lineStyle(2, 0x4dd2ff, 0.9);
    panel.strokeRoundedRect(px, py, panelW, panelH, 12);
    parts.push(panel);

    const panelBlocker = this.add.zone(CX, py + panelH / 2, panelW, panelH)
      .setDepth(301)
      .setInteractive();
    panelBlocker.on('pointerdown', (_pointer, _lx, _ly, event) => {
      event?.stopPropagation?.();
    });
    parts.push(panelBlocker);

    const title = this.add.text(CX, py + 16, 'EDITAR PERFIL', {
      fontSize: '20px', fontFamily: 'monospace', color: '#9af4ff',
      stroke: '#0a3142', strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(302);
    parts.push(title);

    const nameLabel = this.add.text(px + 24, py + 58, 'Nombre:', {
      fontSize: '11px', fontFamily: 'monospace', color: '#7fb7d5',
    }).setDepth(302);
    parts.push(nameLabel);

    const nameValue = this.add.text(px + 95, py + 55, this._editNameDraft, {
      fontSize: '16px', fontFamily: 'monospace', color: '#f5fcff',
      backgroundColor: '#123047', padding: { x: 10, y: 5 },
    }).setDepth(302);
    parts.push(nameValue);

    const btnName = this._makeBtn(px + panelW - 92, py + 66, 'CAMBIAR', '#245071', '#32709f').setDepth(302);
    btnName.setScale(0.86);
    btnName.on('pointerdown', (_pointer, _lx, _ly, event) => {
      event?.stopPropagation?.();
      const next = window.prompt('Nuevo nombre (max 12):', this._editNameDraft);
      if (!next || !next.trim()) return;
      this._editNameDraft = next.trim().slice(0, 12);
      nameValue.setText(this._editNameDraft);
    });
    parts.push(btnName);

    const subtitle = this.add.text(CX, py + 102, 'Selecciona personaje', {
      fontSize: '12px', fontFamily: 'monospace', color: '#8fd8ff',
    }).setOrigin(0.5).setDepth(302);
    parts.push(subtitle);

    const cardW = 270;
    const cardH = 200;
    const gap = 24;
    const cardStartX = CX - (cardW * CHARACTER_IDS.length + gap * (CHARACTER_IDS.length - 1)) / 2;
    const cardY = py + 122;

    const refreshCardStyles = () => {
      for (const [id, c] of cards) {
        const selected = id === this._editCharacterDraft;
        c.bg.clear();
        c.bg.fillStyle(selected ? 0x194564 : 0x122a41, 0.96);
        c.bg.fillRoundedRect(c.x, c.y, cardW, cardH, 10);
        c.bg.lineStyle(2, selected ? 0x8ff7ff : 0x2d7ea2, selected ? 1 : 0.6);
        c.bg.strokeRoundedRect(c.x, c.y, cardW, cardH, 10);
      }
    };

    CHARACTER_IDS.forEach((id, idx) => {
      const x = cardStartX + idx * (cardW + gap);
      const y = cardY;
      const def = CHARACTER_DEFS[id];

      const bg = this.add.graphics().setDepth(302);
      parts.push(bg);

      const zone = this.add.zone(x + cardW / 2, y + cardH / 2, cardW, cardH)
        .setDepth(303)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', (_pointer, _lx, _ly, event) => {
        event?.stopPropagation?.();
        this._editCharacterDraft = id;
        refreshCardStyles();
      });
      parts.push(zone);

      const nameTxt = this.add.text(x + cardW / 2, y + 14, def.label.toUpperCase(), {
        fontSize: '16px', fontFamily: 'monospace', color: '#e8f7ff',
      }).setOrigin(0.5, 0).setDepth(303);
      parts.push(nameTxt);

      const idleSpriteKey = def.idle?.down;
      const sprite = this.add.sprite(x + cardW / 2, y + 78, idleSpriteKey).setDepth(303);
      const src = this.textures.get(idleSpriteKey)?.getSourceImage?.();
      const h = src?.height || 125;
      sprite.setScale(64 / h);
      parts.push(sprite);

      const abilityName = this.add.text(x + 12, y + 120, def.abilityName, {
        fontSize: '12px', fontFamily: 'monospace', color: '#9de5ff',
      }).setDepth(303);
      parts.push(abilityName);

      const abilityDesc = this.add.text(x + 12, y + 142, def.abilityDesc, {
        fontSize: '10px', fontFamily: 'monospace', color: '#c8e8ff',
        wordWrap: { width: cardW - 24 },
        lineSpacing: 2,
      }).setDepth(303);
      parts.push(abilityDesc);

      cards.set(id, { bg, x, y });
    });

    refreshCardStyles();

    const btnCancel = this._makeBtn(CX - 94, py + panelH - 28, 'CANCELAR', '#534014', '#7b5e1f').setDepth(302);
    btnCancel.setScale(0.88);
    btnCancel.on('pointerdown', (_pointer, _lx, _ly, event) => {
      event?.stopPropagation?.();
      this._closeEditModal();
    });
    parts.push(btnCancel);

    const btnSave = this._makeBtn(CX + 94, py + panelH - 28, 'GUARDAR', '#14533f', '#1f7b5d').setDepth(302);
    btnSave.setScale(0.88);
    btnSave.on('pointerdown', (_pointer, _lx, _ly, event) => {
      event?.stopPropagation?.();
      const safeName = String(this._editNameDraft || this._playerName || 'Jugador').trim().slice(0, 12) || 'Jugador';
      const safeCharacterId = normalizeCharacterId(this._editCharacterDraft);

      this._playerName = safeName;
      this._selectedCharacterId = safeCharacterId;
      networkManager.playerCharacterId = safeCharacterId;
      if (this._nameDisplay) this._nameDisplay.setText(safeName);

      if (Array.isArray(networkManager.lastPlayers) && networkManager.lastPlayers.length) {
        const mine = networkManager.lastPlayers.find(p => p.playerIndex === networkManager.playerIndex);
        if (mine) {
          mine.name = safeName;
          mine.characterId = safeCharacterId;
        }
      }

      this._rebuildPlayerCards(networkManager.lastPlayers || []);

      if (networkManager.connected && networkManager.roomCode) {
        networkManager.updateProfile({
          name: safeName,
          characterId: safeCharacterId,
        });
        this._setStatus('Actualizando perfil...', '#8fd8ff');
      } else {
        this._setStatus('Perfil actualizado localmente', '#8fd8ff');
      }

      this._closeEditModal();
    });
    parts.push(btnSave);

    dim.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, W, H),
      Phaser.Geom.Rectangle.Contains,
    ).on('pointerdown', () => this._closeEditModal());

    this._editModal = { parts, cards, nameValue };
  }

  _closeEditModal() {
    if (!this._editModal) return;
    this._editModal.parts.forEach((p) => p?.destroy?.());
    this._editModal = null;
  }

  _setRoomCode(code) {
    this._roomCodeRaw = String(code || '').toUpperCase().trim();
    const pretty = this._roomCodeRaw ? this._roomCodeRaw.split('').join(' ') : '';
    this._roomCodeBig.setText(pretty);
  }

  async _copyRoomCode() {
    const code = this._roomCodeRaw || networkManager.roomCode || '';
    if (!code) {
      this._setStatus('No hay codigo para copiar', '#ffb38a');
      return;
    }

    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
        ok = true;
      } else {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      ok = false;
    }

    if (ok) {
      this._setStatus('Codigo copiado: ' + code, '#88ffcc');
      this._btnCopyCode.setText('COPIADO');
      this._btnCopyCode.setStyle({ backgroundColor: '#1f8ea2' });
      if (this._copyResetEvent) this._copyResetEvent.remove(false);
      this._copyResetEvent = this.time.delayedCall(1200, () => {
        if (this._btnCopyCode?.active) {
          this._btnCopyCode.setText('COPIAR CODIGO');
          this._btnCopyCode.setStyle({ backgroundColor: this._btnCopyCode._normalBg || '#0f5a66' });
        }
      });
    } else {
      this._setStatus('No se pudo copiar automaticamente', '#ff8866');
    }
  }

  _rebuildPlayerCards(players) {
    this._playerCards.forEach(o => o && o.destroy && o.destroy());
    this._playerCards = [];
    const list = Array.isArray(players) ? players : [];
    if (this._playersCountText) this._playersCountText.setText(`${list.length}/5 ONLINE`);

    const rowTop = 146;
    const rowH = 27;

    if (!list.length) {
      const empty = this.add.text(CX, rowTop + 62, 'Aun no hay jugadores conectados', {
        fontSize: '12px', fontFamily: 'monospace', color: '#6f8ea2',
      }).setOrigin(0.5);
      this._playerCards.push(empty);
      return;
    }

    for (let i = 0; i < 5; i++) {
      const y = rowTop + i * rowH;
      const row = this.add.graphics();
      row.fillStyle(i % 2 === 0 ? 0x11263a : 0x0d2031, 0.95);
      row.fillRoundedRect(CX - 270, y, 540, rowH - 2, 6);
      this._playerCards.push(row);

      const p = list[i];
      if (!p) {
        const slot = this.add.text(CX - 248, y + 12, `Slot ${i + 1}: esperando jugador...`, {
          fontSize: '11px', fontFamily: 'monospace', color: '#527088',
        }).setOrigin(0, 0.5);
        this._playerCards.push(slot);
        continue;
      }

      const { playerIndex, name } = p;
      const characterId = normalizeCharacterId(p.characterId || DEFAULT_CHARACTER_ID);
      const pc = PLAYER_COLORS[playerIndex] || PLAYER_COLORS[0];
      const leftChip = this.add.graphics();
      leftChip.fillStyle(pc.main, 0.95);
      leftChip.fillRoundedRect(CX - 262, y + 5, 40, rowH - 12, 4);
      this._playerCards.push(leftChip);

      const idxText = this.add.text(CX - 242, y + 12, `P${playerIndex + 1}`, {
        fontSize: '10px', fontFamily: 'monospace', color: '#001018', fontStyle: 'bold',
      }).setOrigin(0.5);
      this._playerCards.push(idxText);

      const displayName = (name || ('Jugador ' + (playerIndex + 1))).slice(0, 12);
      const nameText = this.add.text(CX - 210, y + 12, displayName, {
        fontSize: '12px', fontFamily: 'monospace', color: '#e9f7ff',
      }).setOrigin(0, 0.5);
      this._playerCards.push(nameText);

      if (playerIndex === networkManager.playerIndex) {
        this._playerName = displayName;
        this._selectedCharacterId = characterId;
        networkManager.playerCharacterId = characterId;
        if (this._nameDisplay) this._nameDisplay.setText(displayName);
      }

      const charTag = this.add.text(CX + 86, y + 12, characterId.toUpperCase(), {
        fontSize: '9px', fontFamily: 'monospace', color: '#001018',
        backgroundColor: '#89d5ff', padding: { x: 4, y: 1 },
      }).setOrigin(0.5);
      this._playerCards.push(charTag);

      if (playerIndex === 0) {
        const hostTag = this.add.text(CX + 142, y + 12, 'HOST', {
          fontSize: '9px', fontFamily: 'monospace', color: '#03121b',
          backgroundColor: '#7de7ff', padding: { x: 4, y: 1 },
        }).setOrigin(0.5);
        this._playerCards.push(hostTag);
      }

      if (playerIndex === networkManager.playerIndex) {
        const meTag = this.add.text(CX + 192, y + 12, 'TU', {
          fontSize: '9px', fontFamily: 'monospace', color: '#132200',
          backgroundColor: '#d9ff6f', padding: { x: 4, y: 1 },
        }).setOrigin(0.5);
        this._playerCards.push(meTag);

        const renameBtn = this.add.text(CX + 248, y + 12, 'EDITAR', {
          fontSize: '9px', fontFamily: 'monospace', color: '#9ef8ff',
          backgroundColor: '#14425c', padding: { x: 6, y: 2 },
        })
          .setOrigin(1, 0.5)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => this._openEditModal())
          .on('pointerover', () => renameBtn.setStyle({ backgroundColor: '#1f6b92', color: '#ffffff' }))
          .on('pointerout', () => renameBtn.setStyle({ backgroundColor: '#14425c', color: '#9ef8ff' }));
        this._playerCards.push(renameBtn);
      }
    }
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
        this._setRoomCode(roomCode);
        this._shareHint.setText('Comparte este código con tus amigos');
        this._showGroup(this._grpRole,   false);
        this._showGroup(this._grpJoin,   false);
        this._showGroup(this._grpRoom,   true);
        this._showGroup(this._grpHost,   true);
        this._showGroup(this._grpClient, false);
        this._btnStart.setAlpha(0.4);
        this._setStatus('Sala creada. Esperando jugadores...', '#88ff88');
      }),
      networkManager.on('room_joined', ({ roomCode }) => {
        this._setRoomCode(roomCode);
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
      networkManager.on('player_left', ({ playerIndex }) => {
        this._setStatus('P' + (playerIndex + 1) + ' abandonó la sala', '#ffaa88');
      }),
      networkManager.on('game_start', ({ playerCount, seed, playerNames, playerProfiles, itemConfig }) => {
        this._cleanup();
        this.scene.start('GameScene', {
          playerCount, online: true,
          isHost: networkManager.isHost,
          myPlayerIndex: networkManager.playerIndex,
          roomCode: networkManager.roomCode,
          seed, playerNames, playerProfiles, itemConfig,
        });
      }),
      networkManager.on('return_to_lobby', ({ players, playerCount, roomCode }) => {
        // Could arrive if another tab / reconnect triggers it while already in lobby
        this._showGroup(this._grpJoin, false);
        this._showGroup(this._grpRoom, true);
        if (networkManager.isHost) {
          this._showGroup(this._grpHost, true);
          this._showGroup(this._grpClient, false);
        } else {
          this._showGroup(this._grpHost, false);
          this._showGroup(this._grpClient, true);
        }
        this._setRoomCode(roomCode || networkManager.roomCode);
        this._rebuildPlayerCards(players || []);
        this._setStatus('De vuelta en el lobby.', '#88ff88');
      }),
      networkManager.on('host_left', () => {
        networkManager.disconnect();
        this._cleanup();
        this.scene.start('MenuScene');
      }),
      networkManager.on('disconnected', () => {
        this._closeEditModal();
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

  _cleanup() {
    this._closeEditModal();
    this._unsubs.forEach(u => u());
    this._unsubs = [];
  }
}
