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
