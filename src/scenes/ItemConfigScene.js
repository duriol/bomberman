import { GAME_WIDTH, CANVAS_HEIGHT, ITEM, ITEM_WEIGHTS } from '../data/constants.js';
import { networkManager } from '../systems/NetworkManager.js';

const W  = GAME_WIDTH;
const H  = CANVAS_HEIGHT;
const CX = W / 2;

export const MAX_TOTAL_ITEMS = 40;

const ITEM_DEFS = [
  { type: ITEM.BOMB_UP,    label: 'Más Bombas',    desc: '+1 capacidad de bomba',          color: '#ff8844', default: 5 },
  { type: ITEM.FIRE_UP,    label: 'Más Fuego',     desc: '+1 radio de explosión',          color: '#ff4444', default: 5 },
  { type: ITEM.SPEED_UP,   label: 'Velocidad',     desc: '+velocidad de movimiento',       color: '#44ff88', default: 4 },
  { type: ITEM.KICK,       label: 'Patada',        desc: 'Patear bombas al pasar junto',   color: '#4488ff', default: 3 },
  { type: ITEM.MULTI_BOMB, label: 'Multi-Bomba',   desc: 'Todas las bombas de un golpe',   color: '#ffdd00', default: 2 },
  { type: ITEM.SKULL,      label: 'Calavera',      desc: 'Maldición: aleatorio o invertido',color: '#cc44ff', default: 1 },
  { type: ITEM.RUSH,       label: 'Rush',          desc: 'Maldición: arrastre hasta pared',color: '#ff44aa', default: 0 },
];

export class ItemConfigScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ItemConfigScene' });
  }

  init() {
    this._counts = {};
    ITEM_DEFS.forEach(d => { this._counts[d.type] = d.default; });
    this._unsubs = [];
    this._rows   = [];
    this._launched = false;
  }

  create() {
    // Background
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0d001a, 0x0d001a, 0x001a30, 0x001a30, 1);
    bg.fillRect(0, 0, W, H);

    // Title
    this.add.text(CX, 32, 'CONFIGURAR ITEMS', {
      fontSize: '26px', fontFamily: 'monospace',
      color: '#ffdd00', stroke: '#ff6600', strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(CX, 68, `Elige cuántos items de cada tipo habrá · máximo ${MAX_TOTAL_ITEMS} en total`, {
      fontSize: '11px', fontFamily: 'monospace', color: '#556688',
    }).setOrigin(0.5);

    // Total counter
    this._totalText = this.add.text(CX, 92, '', {
      fontSize: '14px', fontFamily: 'monospace', color: '#aaddff',
    }).setOrigin(0.5);

    // Top divider
    const div1 = this.add.graphics();
    div1.lineStyle(1, 0x334466);
    div1.lineBetween(60, 110, W - 60, 110);

    // Item rows
    const startY = 138;
    const rowH   = 54;
    ITEM_DEFS.forEach((def, i) => this._buildItemRow(def, startY + i * rowH));

    // Bottom divider
    const endY = startY + ITEM_DEFS.length * rowH;
    const div2 = this.add.graphics();
    div2.lineStyle(1, 0x334466);
    div2.lineBetween(60, endY, W - 60, endY);

    // Status / error message
    this._statusText = this.add.text(CX, endY + 28, '', {
      fontSize: '13px', fontFamily: 'monospace', color: '#ff8866',
    }).setOrigin(0.5);

    // Launch button
    this._btnLaunch = this._makeBtn(CX, endY + 64, '▶  INICIAR PARTIDA', '#776600');
    this._btnLaunch.on('pointerdown', () => this._launch());

    // Back link
    const back = this.add.text(CX, H - 22, '← Volver al lobby', {
      fontSize: '12px', fontFamily: 'monospace', color: '#555555',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    back.on('pointerover', () => back.setStyle({ color: '#ffffff' }));
    back.on('pointerout',  () => back.setStyle({ color: '#555555' }));
    back.on('pointerdown', () => { this._cleanup(); this.scene.start('LobbyScene'); });

    this._updateDisplay();
    this._registerListeners();
  }

  _buildItemRow(def, y) {
    // Row background
    const rowBg = this.add.graphics();
    rowBg.fillStyle(0x111133, 0.5);
    rowBg.fillRoundedRect(60, y - 4, W - 120, 50, 6);

    // Accent bar
    const accentHex = parseInt(def.color.replace('#', ''), 16);
    const accentBar = this.add.graphics();
    accentBar.fillStyle(accentHex, 0.85);
    accentBar.fillRect(60, y - 4, 5, 50);

    // Label
    this.add.text(78, y + 6, def.label, {
      fontSize: '15px', fontFamily: 'monospace', color: def.color,
    });

    // Description
    this.add.text(78, y + 26, def.desc, {
      fontSize: '10px', fontFamily: 'monospace', color: '#667799',
    });

    // — button
    const btnMinus = this.add.text(W - 198, y + 18, '–', {
      fontSize: '20px', fontFamily: 'monospace',
      color: '#ffffff', backgroundColor: '#441111',
      padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    btnMinus.on('pointerdown', () => {
      if (this._counts[def.type] <= 0) return;
      this._counts[def.type]--;
      this._updateDisplay();
    });
    btnMinus.on('pointerover', () => btnMinus.setStyle({ color: '#ffdd00' }));
    btnMinus.on('pointerout',  () => btnMinus.setStyle({ color: '#ffffff' }));

    // Count display
    const countTxt = this.add.text(W - 150, y + 18, '0', {
      fontSize: '20px', fontFamily: 'monospace',
      color: '#ffdd00', backgroundColor: '#0a0a22',
      padding: { x: 12, y: 4 },
    }).setOrigin(0.5);

    // + button
    const btnPlus = this.add.text(W - 98, y + 18, '+', {
      fontSize: '20px', fontFamily: 'monospace',
      color: '#ffffff', backgroundColor: '#114411',
      padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    btnPlus.on('pointerdown', () => {
      if (this._total() >= MAX_TOTAL_ITEMS) return;
      this._counts[def.type]++;
      this._updateDisplay();
    });
    btnPlus.on('pointerover', () => btnPlus.setStyle({ color: '#ffdd00' }));
    btnPlus.on('pointerout',  () => btnPlus.setStyle({ color: '#ffffff' }));

    this._rows.push({ type: def.type, countTxt, btnMinus, btnPlus });
  }

  _total() {
    return Object.values(this._counts).reduce((a, b) => a + b, 0);
  }

  _updateDisplay() {
    const total   = this._total();
    const atLimit = total >= MAX_TOTAL_ITEMS;

    const color = atLimit ? '#ff5555' : total >= MAX_TOTAL_ITEMS * 0.7 ? '#ffdd00' : '#88ffaa';
    this._totalText
      .setText(`Items totales: ${total} / ${MAX_TOTAL_ITEMS}`)
      .setStyle({ color });

    this._rows.forEach(row => {
      row.countTxt.setText(`${this._counts[row.type]}`);

      const plusDimmed  = atLimit;
      const minusDimmed = this._counts[row.type] <= 0;

      row.btnPlus.setAlpha(plusDimmed   ? 0.3 : 1);
      row.btnMinus.setAlpha(minusDimmed ? 0.3 : 1);
    });

    if (this._btnLaunch) {
      this._btnLaunch.setAlpha(total > 0 ? 1 : 0.4);
    }
  }

  _launch() {
    if (this._launched || this._total() === 0) return;
    this._launched = true;
    this._btnLaunch.setAlpha(0.4);
    this._statusText.setText('Enviando al servidor...').setStyle({ color: '#aaddff' });
    try {
      networkManager.startGame({ ...this._counts });
    } catch (e) {
      this._setError(e.message || 'Sin conexión con el servidor');
    }
  }

  _setError(msg) {
    this._launched = false;
    this._btnLaunch.setAlpha(1);
    this._statusText.setText('✗ ' + msg).setStyle({ color: '#ff6655' });
  }

  _makeBtn(x, y, label, bgColor) {
    const t = this.add.text(x, y, label, {
      fontSize: '16px', fontFamily: 'monospace',
      color: '#ffffff', backgroundColor: bgColor,
      padding: { x: 22, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setAlpha(0.75));
    t.on('pointerout',  () => t.setAlpha(1));
    return t;
  }

  _registerListeners() {
    this._unsubs.push(
      networkManager.on('game_start', ({ playerCount, seed, playerNames, playerProfiles, itemConfig }) => {
        this._cleanup();
        this.scene.start('GameScene', {
          playerCount,
          online:         true,
          isHost:         networkManager.isHost,
          myPlayerIndex:  networkManager.playerIndex,
          roomCode:       networkManager.roomCode,
          seed,
          playerNames,
          playerProfiles,
          itemConfig,
        });
      }),
      networkManager.on('room_error', (msg) => {
        this._setError(msg);
      }),
      networkManager.on('disconnected', () => {
        this._cleanup();
        this.scene.start('LobbyScene');
      }),
    );
  }

  _cleanup() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
  }
}
