import {
  PLAYER_COLORS,
  DEFAULT_CHARACTER_ID,
  CHARACTER_DEFS,
} from '../data/constants.js';
import { preloadCharacterSets, normalizeCharacterId } from '../utils/CharacterAssets.js';

/**
 * MenuScene - online-first home screen.
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  preload() {
    preloadCharacterSets(this);
  }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2;

    this._localProfiles = [
      { name: 'Jugador 1', characterId: DEFAULT_CHARACTER_ID },
      { name: 'Jugador 2', characterId: 'bomby' },
    ];

    this._drawBackground(width, height);
    this._drawHero(cx);
    this._drawOnlinePanel(cx, 220, Math.min(width - 80, 640), 170);
    this._drawLocalPanel(cx, 492, Math.min(width - 56, 664), 286, height);
    this._buildInfoButton(width, height);
  }

  _drawBackground(width, height) {
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x030f1c, 0x030f1c, 0x071d2f, 0x071d2f, 1);
    bg.fillRect(0, 0, width, height);

    // Neon grid to give a futuristic HUD feel.
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x1a4a66, 0.35);
    for (let x = 0; x <= width; x += 36) grid.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += 36) grid.lineBetween(0, y, width, y);

    const glow = this.add.graphics();
    glow.fillStyle(0x19d1ff, 0.08);
    glow.fillCircle(width * 0.18, height * 0.18, 150);
    glow.fillStyle(0x00ffaa, 0.07);
    glow.fillCircle(width * 0.82, height * 0.72, 200);

    const scan = this.add.rectangle(-120, 0, 120, height, 0x66eeff, 0.07)
      .setOrigin(0, 0)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: scan,
      x: width + 140,
      duration: 5200,
      ease: 'Linear',
      repeat: -1,
    });
  }

  _drawHero(cx) {
    this.add.text(cx, 52, 'BOMBERMAN // GRIDNET', {
      fontSize: '44px',
      fontFamily: 'monospace',
      color: '#8ff6ff',
      stroke: '#0a3242',
      strokeThickness: 6,
    }).setOrigin(0.5);

    this.add.text(cx, 95, 'ONLINE FIRST ARENA', {
      fontSize: '16px',
      fontFamily: 'monospace',
      color: '#00ffb7',
      backgroundColor: '#0b1f2b',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5);

    this.add.text(cx, 128, 'Crea o unete a una sala privada. El modo local queda como opcion rapida.', {
      fontSize: '12px',
      fontFamily: 'monospace',
      color: '#9fbed3',
      align: 'center',
    }).setOrigin(0.5);
  }

  _drawPanel(cx, cy, w, h, fill = 0x081725, border = 0x2ed6ff) {
    const x = cx - w / 2;
    const y = cy - h / 2;

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.35);
    shadow.fillRoundedRect(x + 4, y + 4, w, h, 14);

    const panel = this.add.graphics();
    panel.fillStyle(fill, 0.9);
    panel.fillRoundedRect(x, y, w, h, 14);
    panel.lineStyle(2, border, 0.7);
    panel.strokeRoundedRect(x, y, w, h, 14);

    return { x, y, w, h };
  }

  _drawOnlinePanel(cx, cy, w, h) {
    const box = this._drawPanel(cx, cy, w, h, 0x071e2b, 0x18dfff);

    this.add.text(cx, box.y + 22, 'PARTIDA ONLINE', {
      fontSize: '24px',
      fontFamily: 'monospace',
      color: '#8cefff',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0);

    this.add.text(cx, box.y + 58, 'Lobby, codigo de sala, host/invitado y configuracion compartida', {
      fontSize: '11px',
      fontFamily: 'monospace',
      color: '#a3bfd1',
    }).setOrigin(0.5, 0);

    const btn = this.add.text(cx, box.y + 116, 'ENTRAR AL LOBBY ONLINE', {
      fontSize: '22px',
      fontFamily: 'monospace',
      color: '#02242d',
      backgroundColor: '#43f2ff',
      padding: { x: 24, y: 10 },
    })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene'))
      .on('pointerover', () => {
        btn.setStyle({ backgroundColor: '#00ffd4' });
        this.tweens.add({ targets: btn, scale: 1.04, duration: 90 });
      })
      .on('pointerout', () => {
        btn.setStyle({ backgroundColor: '#43f2ff' });
        this.tweens.add({ targets: btn, scale: 1.0, duration: 90 });
      });

    this.tweens.add({
      targets: btn,
      alpha: { from: 1, to: 0.82 },
      duration: 900,
      yoyo: true,
      repeat: -1,
    });
  }

  _drawLocalPanel(cx, cy, w, h, height) {
    const box = this._drawPanel(cx, cy, w, h, 0x111622, 0x3a4e7a);

    this.add.text(cx, box.y + 14, 'MODO LOCAL (SECUNDARIO)', {
      fontSize: '16px',
      fontFamily: 'monospace',
      color: '#b4bdd8',
      backgroundColor: '#1a2233',
      padding: { x: 6, y: 2 },
    }).setOrigin(0.5, 0);

    this.add.text(cx, box.y + 41, 'Para pruebas locales: 2 jugadores fijos con perfil editable.', {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: '#7e90ad',
    }).setOrigin(0.5, 0);

    this._playerCount = 2;
    this._buildPlayerCards(cx, box.y + 84);
    this._buildStartButton(cx, box.y + 254);
    this._buildControlsHint(cx, Math.min(height - 12, box.y + 278));
  }

  _buildPlayerSelector(cx, y) {
    const btnStyle = {
      fontSize: '24px',
      fontFamily: 'monospace',
      color: '#d8e8ff',
      backgroundColor: '#24324f',
      padding: { x: 12, y: 5 },
    };

    const minus = this.add.text(cx - 92, y, '◀', btnStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        this._playerCount = Math.max(2, this._playerCount - 1);
        this._updateCount();
      })
      .on('pointerover', () => minus.setStyle({ color: '#00ffd4' }))
      .on('pointerout', () => minus.setStyle({ color: '#d8e8ff' }));

    this._countText = this.add.text(cx, y, `${this._playerCount} JUGADORES`, {
      fontSize: '24px',
      fontFamily: 'monospace',
      color: '#f4fbff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5);

    const plus = this.add.text(cx + 92, y, '▶', btnStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        this._playerCount = Math.min(5, this._playerCount + 1);
        this._updateCount();
      })
      .on('pointerover', () => plus.setStyle({ color: '#00ffd4' }))
      .on('pointerout', () => plus.setStyle({ color: '#d8e8ff' }));
  }

  _updateCount() {
    this._countText.setText(`${this._playerCount} JUGADORES`);
    this._rebuildCards();
  }

  _buildPlayerCards(cx, y) {
    this._cardContainer = this.add.container(cx, y);
    this._rebuildCards();
  }

  _rebuildCards() {
    this._cardContainer.removeAll(true);
    const cardW = 226;
    const cardH = 142;
    const gap = 14;
    const total = 2;
    const totalW = total * cardW + (total - 1) * gap;
    const startX = -totalW / 2 + cardW / 2;

    for (let i = 0; i < total; i++) {
      const pc = PLAYER_COLORS[i];
      const profile = this._localProfiles[i] || { name: `Jugador ${i + 1}`, characterId: DEFAULT_CHARACTER_ID };
      const characterId = normalizeCharacterId(profile.characterId);
      const character = CHARACTER_DEFS[characterId];
      const x = startX + i * (cardW + gap);

      const g = this.add.graphics();
      g.fillStyle(pc.shadow, 0.8);
      g.fillRoundedRect(x - cardW / 2 + 2, 2, cardW, cardH, 8);
      g.fillStyle(pc.main, 0.92);
      g.fillRoundedRect(x - cardW / 2, 0, cardW, cardH, 8);
      g.lineStyle(2, 0xd9f2ff, 0.65);
      g.strokeRoundedRect(x - cardW / 2, 0, cardW, cardH, 8);

      const label = this.add.text(x - 92, 16, `P${i + 1}`, {
        fontSize: '16px',
        fontFamily: 'monospace',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      }).setOrigin(0, 0.5);

      const name = this.add.text(x - 92, 40, String(profile.name || `Jugador ${i + 1}`).slice(0, 12), {
        fontSize: '12px',
        fontFamily: 'monospace',
        color: '#f6fcff',
      }).setOrigin(0, 0.5);

      const charTag = this.add.text(x - 92, 60, `Personaje: ${character.label}`, {
        fontSize: '10px',
        fontFamily: 'monospace',
        color: '#9ad6ff',
      }).setOrigin(0, 0.5);

      const controlsText = i === 0
        ? 'Mover: WASD  |  Acciones: 1(J) 2(K) 3(H) 4(U)'
        : 'Mover: Flechas  |  Acciones: 1(;) 2(\') 3(L) 4(P)';
      const controls = this.add.text(x - 92, 84, controlsText, {
        fontSize: '9px',
        fontFamily: 'monospace',
        color: '#eef5ff',
        wordWrap: { width: 168 },
      }).setOrigin(0, 0.5);

      const sprite = this.add.sprite(x + 76, 50, character.idle.down).setOrigin(0.5);
      const src = this.textures.get(character.idle.down)?.getSourceImage?.();
      const h = src?.height || 125;
      sprite.setScale(56 / h);

      const editBtn = this.add.text(x + 72, 112, 'EDITAR', {
        fontSize: '11px',
        fontFamily: 'monospace',
        color: '#dff8ff',
        backgroundColor: '#2a4968',
        padding: { x: 8, y: 4 },
      })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this._editLocalProfile(i))
        .on('pointerover', () => editBtn.setStyle({ backgroundColor: '#3d6790' }))
        .on('pointerout', () => editBtn.setStyle({ backgroundColor: '#2a4968' }));

      this._cardContainer.add([g, label, name, charTag, controls, sprite, editBtn]);
    }
  }

  _editLocalProfile(playerIndex) {
    const current = this._localProfiles[playerIndex] || {
      name: `Jugador ${playerIndex + 1}`,
      characterId: DEFAULT_CHARACTER_ID,
    };

    const nextName = window.prompt('Nombre local (max 12):', current.name || `Jugador ${playerIndex + 1}`);
    if (nextName && nextName.trim()) {
      current.name = nextName.trim().slice(0, 12);
    }

    const nextCharacter = window.prompt(
      'Personaje local (wolf o bomby):',
      current.characterId || DEFAULT_CHARACTER_ID,
    );
    if (nextCharacter && nextCharacter.trim()) {
      current.characterId = normalizeCharacterId(nextCharacter);
    }

    this._localProfiles[playerIndex] = current;
    this._rebuildCards();
  }

  _buildStartButton(cx, y) {
    const btn = this.add.text(cx, y, 'INICIAR PARTIDA LOCAL', {
      fontSize: '18px',
      fontFamily: 'monospace',
      color: '#d8e5ff',
      backgroundColor: '#28334e',
      padding: { x: 18, y: 8 },
    })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._startGame())
      .on('pointerover', () => {
        btn.setStyle({ backgroundColor: '#3a4a70' });
        this.tweens.add({ targets: btn, scale: 1.03, duration: 90 });
      })
      .on('pointerout', () => {
        btn.setStyle({ backgroundColor: '#28334e' });
        this.tweens.add({ targets: btn, scale: 1.0, duration: 90 });
      });
  }

  _buildControlsHint(cx, y) {
    this.add.text(cx, y, 'Local prueba: 2 jugadores | Perfil editable por tarjeta | Online sigue siendo prioritario', {
      fontSize: '9px',
      fontFamily: 'monospace',
      color: '#617998',
    }).setOrigin(0.5);
  }

  _buildInfoButton(width, height) {
    const DEPTH = 200;
    const btnSize = 36;
    const margin = 12;
    const bx = width - margin - btnSize / 2;
    const by = height - margin - btnSize / 2;

    const btnBg = this.add.graphics().setDepth(DEPTH);
    btnBg.fillStyle(0x154163);
    btnBg.fillCircle(bx, by, btnSize / 2);
    btnBg.lineStyle(2, 0x57dbff, 1);
    btnBg.strokeCircle(bx, by, btnSize / 2);

    const btnLabel = this.add.text(bx, by, 'i', {
      fontSize: '20px',
      fontFamily: 'monospace',
      color: '#7fe6ff',
    }).setOrigin(0.5, 0.5).setDepth(DEPTH);

    const hitZone = this.add.zone(bx, by, btnSize + 8, btnSize + 8)
      .setInteractive({ useHandCursor: true })
      .setDepth(DEPTH);

    this._legendPanel = this._buildLegendPanel(width, height, DEPTH + 1);
    this._legendVisible = false;

    const toggleLegend = () => {
      this._legendVisible = !this._legendVisible;
      this._legendPanel.setVisible(this._legendVisible);
      btnBg.clear();
      if (this._legendVisible) {
        btnBg.fillStyle(0x57dbff);
        btnBg.fillCircle(bx, by, btnSize / 2);
        btnLabel.setStyle({ color: '#022232' });
      } else {
        btnBg.fillStyle(0x154163);
        btnBg.fillCircle(bx, by, btnSize / 2);
        btnBg.lineStyle(2, 0x57dbff, 1);
        btnBg.strokeCircle(bx, by, btnSize / 2);
        btnLabel.setStyle({ color: '#7fe6ff' });
      }
    };

    hitZone.on('pointerdown', toggleLegend);
    this.input.keyboard.on('keydown-ESC', () => {
      if (this._legendVisible) toggleLegend();
    });
  }

  _buildLegendPanel(width, height, depth) {
    const ITEMS = [
      { icon: '💣', name: 'Bomba extra', desc: 'Permite colocar\nuna bomba mas (max 6)', key: 'Automatico' },
      { icon: '🔥', name: 'Fuego', desc: 'Aumenta el alcance\nde la explosion', key: 'Automatico' },
      { icon: '⚡', name: 'Velocidad', desc: 'Aumenta la\nvelocidad', key: 'Automatico' },
      { icon: '💥', name: 'Multi-bomba', desc: 'Pone todas tus bombas en la direccion que miras', key: 'Accion 3 (H / L)' },
      { icon: '👟', name: 'Patada', desc: 'Patea bombas al\npasar junto a ellas', key: 'Automatico' },
      { icon: '💀', name: 'Maldicion', desc: 'Movimiento aleatorio\ndurante 10 seg', key: 'Trampa' },
      { icon: '🌀', name: 'Enganche', desc: 'Al moverte saldras\ndisparado hasta la pared', key: 'Trampa' },
    ];

    const panelW = Math.min(width - 40, 660);
    const panelH = 390;
    const px = (width - panelW) / 2;
    const py = (height - panelH) / 2;

    const container = this.add.container(0, 0).setDepth(depth).setVisible(false);

    const dim = this.add.graphics();
    dim.fillStyle(0x000000, 0.68);
    dim.fillRect(0, 0, width, height);
    container.add(dim);

    const panel = this.add.graphics();
    panel.fillStyle(0x081c2f, 0.95);
    panel.fillRoundedRect(px, py, panelW, panelH, 14);
    panel.lineStyle(2, 0x2db9df);
    panel.strokeRoundedRect(px, py, panelW, panelH, 14);
    container.add(panel);

    container.add(this.add.text(width / 2, py + 22, 'Leyenda de items', {
      fontSize: '18px',
      fontFamily: 'monospace',
      color: '#8cefff',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 0));

    container.add(this.add.text(width / 2, py + 46, 'Acciones: 1 habilidad, 2 bomba, 3 item, 4 reservado', {
      fontSize: '9px',
      fontFamily: 'monospace',
      color: '#6f9eb9',
    }).setOrigin(0.5, 0));

    container.add(this.add.text(width / 2, py + 58, 'P1: J/K/H/U | P2: ;/\'/L/P | Movil: 1 abajo, 2 derecha, 3 izquierda, 4 arriba', {
      fontSize: '9px',
      fontFamily: 'monospace',
      color: '#6f9eb9',
    }).setOrigin(0.5, 0));

    const cols = 2;
    const cellW = (panelW - 32) / cols;
    const cellH = 68;
    const gridTop = py + 86;

    ITEMS.forEach((item, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const sx = px + 16 + col * cellW;
      const sy = gridTop + row * cellH;

      const cell = this.add.graphics();
      cell.fillStyle(0x0d2a44, 0.94);
      cell.fillRoundedRect(sx, sy, cellW - 10, cellH - 8, 8);
      cell.lineStyle(1, 0x1d5071);
      cell.strokeRoundedRect(sx, sy, cellW - 10, cellH - 8, 8);
      container.add(cell);

      container.add(this.add.text(sx + 22, sy + (cellH - 8) / 2, item.icon, {
        fontSize: '24px',
        fontFamily: 'serif',
      }).setOrigin(0.5, 0.5));

      container.add(this.add.text(sx + 46, sy + 8, item.name, {
        fontSize: '12px',
        fontFamily: 'monospace',
        color: '#defaff',
      }));

      container.add(this.add.text(sx + 46, sy + 24, item.desc, {
        fontSize: '9px',
        fontFamily: 'monospace',
        color: '#9fc6de',
        lineSpacing: 2,
      }));

      container.add(this.add.text(sx + cellW - 18, sy + (cellH - 8) / 2, item.key, {
        fontSize: '8px',
        fontFamily: 'monospace',
        color: '#63ff9d',
        backgroundColor: '#0c2514',
        padding: { x: 4, y: 2 },
      }).setOrigin(1, 0.5));
    });

    container.add(this.add.text(width / 2, py + panelH - 20, 'Pulsa ESC o i para cerrar', {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: '#5f7c96',
    }).setOrigin(0.5, 1));

    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains)
      .on('pointerdown', () => {
        if (this._legendVisible) this._legendPanel.setVisible(false);
        this._legendVisible = false;
      });

    return container;
  }

  _startGame() {
    this.scene.start('GameScene', {
      playerCount: 2,
      playerProfiles: this._localProfiles,
    });
  }
}