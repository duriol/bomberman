import { PLAYER_COLORS } from '../data/constants.js';

/**
 * MenuScene — player count selection screen.
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2;

    // Background gradient
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x1a0030, 0x1a0030, 0x003060, 0x003060, 1);
    bg.fillRect(0, 0, width, height);

    // Title
    this.add.text(cx, 80, 'BOMBERMAN', {
      fontSize: '56px',
      fontFamily: 'monospace',
      color: '#ffdd00',
      stroke: '#ff6600',
      strokeThickness: 6,
      shadow: { offsetX: 4, offsetY: 4, color: '#000000', blur: 8, fill: true },
    }).setOrigin(0.5);

    this.add.text(cx, 145, 'Multijugador Local', {
      fontSize: '18px',
      fontFamily: 'monospace',
      color: '#aaddff',
    }).setOrigin(0.5);

    // Player count selector
    this.add.text(cx, 220, '¿Cuántos jugadores?', {
      fontSize: '22px',
      fontFamily: 'monospace',
      color: '#ffffff',
    }).setOrigin(0.5);

    this._playerCount = 2;
    this._countText   = null;
    this._buildPlayerSelector(cx, 280);
    this._buildPlayerCards(cx, 360);
    this._buildStartButton(cx, height - 110);
    this._buildOnlineButton(cx, height - 60);
    this._buildControlsHint(cx, height - 18);
    this._buildInfoButton(width, height);
  }

  _buildPlayerSelector(cx, y) {
    const btnStyle = {
      fontSize: '28px',
      fontFamily: 'monospace',
      color: '#ffffff',
      backgroundColor: '#333366',
      padding: { x: 12, y: 6 },
    };

    const minus = this.add.text(cx - 80, y, '◀', btnStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        this._playerCount = Math.max(2, this._playerCount - 1);
        this._updateCount();
      })
      .on('pointerover', () => minus.setStyle({ color: '#ffdd00' }))
      .on('pointerout',  () => minus.setStyle({ color: '#ffffff' }));

    this._countText = this.add.text(cx, y, `${this._playerCount}`, {
      fontSize: '36px',
      fontFamily: 'monospace',
      color: '#ffdd00',
    }).setOrigin(0.5);

    const plus = this.add.text(cx + 80, y, '▶', btnStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        this._playerCount = Math.min(5, this._playerCount + 1);
        this._updateCount();
      })
      .on('pointerover', () => plus.setStyle({ color: '#ffdd00' }))
      .on('pointerout',  () => plus.setStyle({ color: '#ffffff' }));
  }

  _updateCount() {
    this._countText.setText(`${this._playerCount}`);
    this._rebuildCards();
  }

  _buildPlayerCards(cx, y) {
    this._cardContainer = this.add.container(cx, y);
    this._rebuildCards();
  }

  _rebuildCards() {
    this._cardContainer.removeAll(true);
    const cardW = 90, cardH = 70, gap = 10;
    const total = this._playerCount;
    const totalW = total * cardW + (total - 1) * gap;
    const startX = -totalW / 2 + cardW / 2;

    for (let i = 0; i < total; i++) {
      const pc = PLAYER_COLORS[i];
      const x  = startX + i * (cardW + gap);

      const bg = this.add.graphics();
      bg.fillStyle(pc.shadow, 0.8);
      bg.fillRoundedRect(x - cardW / 2 + 2, 2, cardW, cardH, 8);
      bg.fillStyle(pc.main, 0.9);
      bg.fillRoundedRect(x - cardW / 2, 0, cardW, cardH, 8);
      bg.lineStyle(2, 0xffffff, 0.5);
      bg.strokeRoundedRect(x - cardW / 2, 0, cardW, cardH, 8);

      const label = this.add.text(x, 14, `P${i + 1}`, {
        fontSize: '18px',
        fontFamily: 'monospace',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      }).setOrigin(0.5);

      const controls = this.add.text(x, 45, pc.keys, {
        fontSize: '8px',
        fontFamily: 'monospace',
        color: '#eeeeee',
        wordWrap: { width: cardW - 6 },
        align: 'center',
      }).setOrigin(0.5);

      this._cardContainer.add([bg, label, controls]);
    }
  }

  _buildStartButton(cx, y) {
    const btn = this.add.text(cx, y, '▶  JUGAR', {
      fontSize: '28px',
      fontFamily: 'monospace',
      color: '#111111',
      backgroundColor: '#ffdd00',
      padding: { x: 24, y: 10 },
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true })
    .on('pointerdown', () => this._startGame())
    .on('pointerover', () => {
      btn.setStyle({ backgroundColor: '#ffaa00' });
      this.tweens.add({ targets: btn, scale: 1.06, duration: 80 });
    })
    .on('pointerout',  () => {
      btn.setStyle({ backgroundColor: '#ffdd00' });
      this.tweens.add({ targets: btn, scale: 1.0, duration: 80 });
    });

    // Pulse effect on start
    this.tweens.add({
      targets: btn,
      alpha: { from: 1, to: 0.8 },
      duration: 700,
      yoyo: true,
      repeat: -1,
    });
  }

  _buildControlsHint(cx, y) {
    this.add.text(cx, y, 'Controles: ver tarjetas de jugadores arriba', {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: '#888888',
    }).setOrigin(0.5);
  }

  _buildInfoButton(width, height) {
    const DEPTH = 200;
    const btnSize = 36;
    const margin  = 12;
    const bx = width  - margin - btnSize / 2;
    const by = height - margin - btnSize / 2;

    // ── Info badge ──────────────────────────────────────────────────
    const btnBg = this.add.graphics().setDepth(DEPTH);
    btnBg.fillStyle(0x1a3a6a);
    btnBg.fillCircle(bx, by, btnSize / 2);
    btnBg.lineStyle(2, 0x55aaff, 1);
    btnBg.strokeCircle(bx, by, btnSize / 2);

    const btnLabel = this.add.text(bx, by, 'ℹ', {
      fontSize: '20px',
      fontFamily: 'serif',
      color: '#55aaff',
    }).setOrigin(0.5, 0.5).setDepth(DEPTH);

    // Invisible hit area
    const hitZone = this.add.zone(bx, by, btnSize + 8, btnSize + 8)
      .setInteractive({ useHandCursor: true })
      .setDepth(DEPTH);

    // ── Legend panel (starts hidden) ────────────────────────────────
    this._legendPanel = this._buildLegendPanel(width, height, DEPTH + 1);
    this._legendVisible = false;

    const toggleLegend = () => {
      this._legendVisible = !this._legendVisible;
      this._legendPanel.setVisible(this._legendVisible);
      btnBg.clear();
      if (this._legendVisible) {
        btnBg.fillStyle(0x55aaff);
        btnBg.fillCircle(bx, by, btnSize / 2);
        btnLabel.setStyle({ color: '#001133' });
      } else {
        btnBg.fillStyle(0x1a3a6a);
        btnBg.fillCircle(bx, by, btnSize / 2);
        btnBg.lineStyle(2, 0x55aaff, 1);
        btnBg.strokeCircle(bx, by, btnSize / 2);
        btnLabel.setStyle({ color: '#55aaff' });
      }
    };

    hitZone.on('pointerdown', toggleLegend);

    // Close with Escape
    this.input.keyboard.on('keydown-ESC', () => {
      if (this._legendVisible) toggleLegend();
    });
  }

  _buildLegendPanel(width, height, depth) {
    const ITEMS = [
      { icon: '💣', name: 'Bomba extra',    desc: 'Permite colocar\nuna bomba más (máx 6)',    key: 'Automático'        },
      { icon: '🔥', name: 'Fuego',          desc: 'Aumenta el alcance\nde la explosión',       key: 'Automático'        },
      { icon: '⚡', name: 'Velocidad',      desc: 'Aumenta la\nvelocidad',                    key: 'Automático'        },
      { icon: '💥', name: 'Multi-bomba',    desc: 'Pone todas tus bombas en la dirección que miras', key: 'E / Shift / U' },
      { icon: '👟', name: 'Patada',         desc: 'Patea bombas al\npasar junto a ellas',      key: 'Automático'        },
      { icon: '💀', name: 'Maldición',      desc: 'Movimiento aleatorio\ndurante 10 seg',      key: '— (trampa)'        },
      { icon: '🌀', name: 'Enganche',       desc: 'Al moverte saldrás\ndisparado hasta la pared', key: '— (trampa)'     },
    ];

    const panelW = Math.min(width - 40, 660);
    const panelH = 390;
    const px     = (width  - panelW) / 2;
    const py     = (height - panelH) / 2;

    const container = this.add.container(0, 0).setDepth(depth).setVisible(false);

    // Dim overlay
    const dim = this.add.graphics();
    dim.fillStyle(0x000000, 0.65);
    dim.fillRect(0, 0, width, height);
    container.add(dim);

    // Panel background
    const panel = this.add.graphics();
    panel.fillStyle(0x0a1a30);
    panel.fillRoundedRect(px, py, panelW, panelH, 14);
    panel.lineStyle(2, 0x3366aa);
    panel.strokeRoundedRect(px, py, panelW, panelH, 14);
    container.add(panel);

    // Title row
    const title = this.add.text(width / 2, py + 22, 'Leyenda de Ítems', {
      fontSize: '18px', fontFamily: 'monospace',
      color: '#ffdd00', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 0);
    container.add(title);

    const colKeys = ['P1: E', 'P2: Shift', 'P3: O', 'P4: Num+', 'P5: Y'];
    const actionHint = this.add.text(width / 2, py + 46, '— tecla de acción por jugador: ' + colKeys.join('  ·  '), {
      fontSize: '9px', fontFamily: 'monospace', color: '#7799bb',
    }).setOrigin(0.5, 0);
    container.add(actionHint);

    // Grid: 2 columns
    const cols    = 2;
    const cellW   = (panelW - 32) / cols;
    const cellH   = 68;
    const gridTop = py + 72;

    ITEMS.forEach((item, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cx  = px + 16 + col * cellW;
      const cy  = gridTop + row * cellH;

      // Cell bg
      const cellBg = this.add.graphics();
      cellBg.fillStyle(0x0f2540, 0.9);
      cellBg.fillRoundedRect(cx, cy, cellW - 10, cellH - 8, 8);
      cellBg.lineStyle(1, 0x1e3a5a);
      cellBg.strokeRoundedRect(cx, cy, cellW - 10, cellH - 8, 8);
      container.add(cellBg);

      // Emoji icon
      const iconText = this.add.text(cx + 22, cy + (cellH - 8) / 2, item.icon, {
        fontSize: '24px', fontFamily: 'serif',
      }).setOrigin(0.5, 0.5);
      container.add(iconText);

      // Item name
      const nameText = this.add.text(cx + 46, cy + 8, item.name, {
        fontSize: '12px', fontFamily: 'monospace', color: '#ffffaa',
      });
      container.add(nameText);

      // Description
      const descText = this.add.text(cx + 46, cy + 24, item.desc, {
        fontSize: '9px', fontFamily: 'monospace', color: '#aaccee',
        lineSpacing: 2,
      });
      container.add(descText);

      // Key hint
      const keyText = this.add.text(cx + cellW - 18, cy + (cellH - 8) / 2, item.key, {
        fontSize: '8px', fontFamily: 'monospace', color: '#55ff88',
        backgroundColor: '#0a2010', padding: { x: 4, y: 2 },
      }).setOrigin(1, 0.5);
      container.add(keyText);
    });

    // Close hint
    const closeHint = this.add.text(width / 2, py + panelH - 20, 'Pulsa ESC o ℹ para cerrar', {
      fontSize: '10px', fontFamily: 'monospace', color: '#557799',
    }).setOrigin(0.5, 1);
    container.add(closeHint);

    // Click outside to close
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains)
      .on('pointerdown', () => { if (this._legendVisible) this._legendPanel.setVisible(false); this._legendVisible = false; });

    return container;
  }

  _buildOnlineButton(cx, y) {
    const btn = this.add.text(cx, y, '🌐  JUGAR ONLINE', {
      fontSize: '18px',
      fontFamily: 'monospace',
      color: '#aaddff',
      backgroundColor: '#112244',
      padding: { x: 18, y: 8 },
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true })
    .on('pointerdown', () => this.scene.start('LobbyScene'))
    .on('pointerover', () => btn.setStyle({ backgroundColor: '#224488', color: '#ffffff' }))
    .on('pointerout',  () => btn.setStyle({ backgroundColor: '#112244', color: '#aaddff' }));
  }

  _startGame() {
    this.scene.start('GameScene', { playerCount: this._playerCount });
  }
}
