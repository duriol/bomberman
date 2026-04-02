import {
  TILE_SIZE, TILE, MAP_COLS, MAP_ROWS,
  GAME_WIDTH, GAME_HEIGHT, HUD_HEIGHT, CANVAS_HEIGHT,
  PLAYER_COLORS, SPAWN_POSITIONS, RESPAWN_DELAY,
} from '../data/constants.js';
import { generateMap, createRng, tileToPixel } from '../utils/MapGenerator.js';
import { generateAssets } from '../utils/AssetFactory.js';
import { Player } from '../entities/Player.js';
import { BombManager, calcExplosionTiles } from '../systems/BombManager.js';
import { ItemManager } from '../systems/ItemManager.js';
import { InputManager } from '../systems/InputManager.js';
import { audioManager } from '../systems/AudioManager.js';
import { networkManager } from '../systems/NetworkManager.js';
import { EXPLOSION_DURATION } from '../data/constants.js';

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  init(data) {
    this.playerCount    = data.playerCount    || 2;
    this.onlineMode     = data.online         || false;
    this.isOnlineHost   = data.isHost         || false;
    this.isOnlineClient = this.onlineMode && !this.isOnlineHost;
    this.myPlayerIndex  = data.myPlayerIndex  ?? 0;
    this._seed          = data.seed           ?? null;
    this._unsubs        = [];
  }

  preload() {
    // Assets are generated programmatically — nothing to load
  }

  create() {
    audioManager.init();

    // Generate all procedural textures
    generateAssets(this);

    // Build map — use seeded RNG when in online mode so all clients share same map
    const rng = this._seed !== null ? createRng(this._seed) : Math.random;
    this.map     = generateMap(0.72, rng);
    this.tilemap = [];

    // Online host: track map changes for diff broadcast
    if (this.isOnlineHost) {
      this._lastSentMap = this.map.map(r => [...r]);
      this._stateSeq    = 0;
      this._netAccum    = 0;
      this._eventBuffer = [];
      this._remoteInputs    = {};
      this._remotePositions = {};
    }

    // Online client: bomb sprites managed separately (no timer logic)
    if (this.isOnlineClient) {
      this._clientBombSprites = new Map(); // key: 'col,row' → sprite
      this._pendingState = null;
    }

    // ── Systems ──────────────────────────────────────────────────────────────
    this.itemManager = new ItemManager(this);

    this.bombManager = new BombManager(
      this,
      this.map,
      (col, row) => {
        // Refresh tile sprite
        this._drawTile(col, row);
        // Maybe drop item (host only — clients sync via state)
        if (!this.isOnlineClient) {
          this.itemManager.tryDrop(col, row);
        }
      },
      (col, row, owner) => {
        if (this.isOnlineClient) return; // host is authoritative for hits
        // Hit all players on this tile
        for (const player of this.players) {
          if (!player.alive) continue;
          const pt = player.tilePos;
          if (pt.col === col && pt.row === row) {
            player.die();
            this._scheduleRespawn(player);
          }
        }
        // Destroy items on this tile
        this.itemManager.destroyAt(col, row);
      },
    );

    // Online host: hook explosion events for state broadcast
    if (this.isOnlineHost) {
      this.bombManager.onExplosionEvent = (ev) => this._eventBuffer.push({ t: 'explode', ...ev });
    }

    this.inputManager = new InputManager(this);

    // ── Render tiles ─────────────────────────────────────────────────────────
    this._drawMap();

    // ── Players ──────────────────────────────────────────────────────────────
    this.players = [];
    for (let i = 0; i < this.playerCount; i++) {
      const p = new Player(this, i, this.map, this.bombManager);
      this.players.push(p);
      // Online host: hook player events into event buffer
      if (this.isOnlineHost) {
        p.onEvent = (ev) => this._eventBuffer.push(ev);
      }
    }

    // ── HUD ──────────────────────────────────────────────────────────────────
    this._buildHUD();

    // ── Round timer ──────────────────────────────────────────────────────────
    this._roundTime = 180;  // seconds
    this._timerEvent = this.time.addEvent({
      delay: 1000,
      callback: this._tickTimer,
      callbackScope: this,
      loop: true,
    });

    // ── Round start sound ──────────────────────────────────────────────────
    audioManager.playRoundStart();
    this.time.delayedCall(600, () => audioManager.startBGM());

    // ── Online listeners ──────────────────────────────────────────────────────
    if (this.isOnlineHost) {
      this._unsubs.push(
        networkManager.on('remote_input', ({ playerIndex, inputs }) => {
          this._remoteInputs[playerIndex] = inputs;
        }),
      );
    } else if (this.isOnlineClient) {
      this._unsubs.push(
        networkManager.on('game_state', (state) => {
          // Keep only most recent state
          this._pendingState = state;
        }),
      );
    }

    this._gameOver = false;
    this._winnerIndex = undefined;
  }

  // ─── Map Rendering ─────────────────────────────────────────────────────────

  _drawMap() {
    // Clear existing tiles
    if (this.tilemap) {
      this.tilemap.forEach(row => row.forEach(s => s && s.destroy()));
    }
    this.tilemap = [];

    for (let row = 0; row < MAP_ROWS; row++) {
      this.tilemap[row] = [];
      for (let col = 0; col < MAP_COLS; col++) {
        this._drawTile(col, row);
      }
    }
  }

  _drawTile(col, row) {
    // Remove old sprite if exists
    if (this.tilemap[row] && this.tilemap[row][col]) {
      this.tilemap[row][col].destroy();
    }

    const pos = tileToPixel(col, row, TILE_SIZE);
    let key;
    switch (this.map[row][col]) {
      case TILE.WALL:  key = 'tile_wall';  break;
      case TILE.BLOCK: key = 'tile_block'; break;
      default:         key = 'tile_floor'; break;
    }

    const sprite = this.add.image(pos.x, pos.y, key).setDepth(0);
    this.tilemap[row][col] = sprite;

    // Block destruction tween (brief flash if it was just a block)
    if (key === 'tile_floor' && this.tilemap[row][col] !== sprite) {
      sprite.setTint(0xffffff);
      this.tweens.add({
        targets: sprite,
        tint: 0xffffff,
        duration: 150,
        onComplete: () => sprite.clearTint(),
      });
    }
  }

  // ─── HUD ───────────────────────────────────────────────────────────────────

  _buildHUD() {
    const hudY = GAME_HEIGHT;

    // HUD background
    const hudBg = this.add.graphics().setDepth(50);
    hudBg.fillStyle(0x111122);
    hudBg.fillRect(0, hudY, GAME_WIDTH, HUD_HEIGHT);
    hudBg.lineStyle(2, 0x3344aa);
    hudBg.lineBetween(0, hudY, GAME_WIDTH, hudY);

    this._hudEntries = [];

    const cardW = GAME_WIDTH / this.playerCount;

    for (let i = 0; i < this.playerCount; i++) {
      const pc = PLAYER_COLORS[i];
      const x  = cardW * i + 8;
      const y  = hudY + 6;

      // Color swatch
      const swatch = this.add.graphics().setDepth(51);
      swatch.fillStyle(pc.main);
      swatch.fillRoundedRect(x, y, 12, 12, 3);

      // Player label
      this.add.text(x + 16, y, `P${i + 1}`, {
        fontSize: '12px', fontFamily: 'monospace',
        color: '#ffffff',
      }).setDepth(51);

      // Lives
      const livesText = this.add.text(x, y + 18, '♥♥♥', {
        fontSize: '12px', fontFamily: 'monospace',
        color: '#ff4466',
      }).setDepth(51);

      // Bombs
      const bombText = this.add.text(x + 50, y + 18, '💣1', {
        fontSize: '11px', fontFamily: 'monospace',
        color: '#ffdd00',
      }).setDepth(51);

      // Range
      const rangeText = this.add.text(x + 85, y + 18, '🔥2', {
        fontSize: '11px', fontFamily: 'monospace',
        color: '#ff8800',
      }).setDepth(51);

      this._hudEntries.push({ livesText, bombText, rangeText });
    }

    // Round timer
    this._timerText = this.add.text(GAME_WIDTH / 2, hudY + 8, '3:00', {
      fontSize: '22px', fontFamily: 'monospace',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(51);

    // ℹ info button (right side of HUD)
    const ibx = GAME_WIDTH - 20;
    const iby = hudY + HUD_HEIGHT / 2;
    const iBg = this.add.graphics().setDepth(52);
    iBg.fillStyle(0x1a3a6a); iBg.fillCircle(ibx, iby, 14);
    iBg.lineStyle(2, 0x55aaff); iBg.strokeCircle(ibx, iby, 14);

    const iLabel = this.add.text(ibx, iby, 'i', {
      fontSize: '16px', fontFamily: 'serif', color: '#55aaff',
      fontStyle: 'italic',
    }).setOrigin(0.5, 0.5).setDepth(52);

    this._legendPanel   = this._buildInGameLegend();
    this._legendVisible = false;

    const zone = this.add.zone(ibx, iby, 32, 32).setInteractive({ useHandCursor: true }).setDepth(52);
    zone.on('pointerdown', () => {
      this._legendVisible = !this._legendVisible;
      this._legendPanel.setVisible(this._legendVisible);
      iBg.clear();
      if (this._legendVisible) {
        iBg.fillStyle(0x55aaff); iBg.fillCircle(ibx, iby, 14);
        iLabel.setStyle({ color: '#001133' });
      } else {
        iBg.fillStyle(0x1a3a6a); iBg.fillCircle(ibx, iby, 14);
        iBg.lineStyle(2, 0x55aaff); iBg.strokeCircle(ibx, iby, 14);
        iLabel.setStyle({ color: '#55aaff' });
      }
    });
    this.input.keyboard.on('keydown-ESC', () => {
      if (this._legendVisible) { this._legendVisible = false; this._legendPanel.setVisible(false); }
    });
  }

  _updateHUD() {
    for (let i = 0; i < this.players.length; i++) {
      const p   = this.players[i];
      const hud = this._hudEntries[i];
      if (!hud) continue;
      hud.livesText.setText('♥'.repeat(Math.max(0, p.lives)));
      hud.bombText.setText(`💣${p.stats.maxBombs}`);
      hud.rangeText.setText(`🔥${p.stats.bombRange}`);
    }
  }

  _tickTimer() {
    if (this._gameOver) return;
    this._roundTime = Math.max(0, this._roundTime - 1);

    const m = Math.floor(this._roundTime / 60);
    const s = this._roundTime % 60;
    this._timerText.setText(`${m}:${s.toString().padStart(2, '0')}`);

    if (this._roundTime <= 30) this._timerText.setStyle({ color: '#ff4444' });
    if (this._roundTime === 60 && !this.isOnlineClient) this._startSpiralClose();
    if (this._roundTime <= 0)  this._endRound(null);
  }

  // ─── Respawn & Game Over ───────────────────────────────────────────────────

  _scheduleRespawn(player) {
    if (player.lives <= 0) {
      this._checkRoundEnd();
      return;
    }
    this.time.delayedCall(RESPAWN_DELAY, () => {
      if (!this._gameOver) player.respawn();
    });
  }

  _checkRoundEnd() {
    const alive = this.players.filter(p => p.alive || p.lives > 0);
    if (alive.length <= 1) {
      this._endRound(alive[0] || null);
    }
  }

  _endRound(winner) {
    if (this._gameOver) return;
    this._gameOver = true;
    this._winnerIndex = winner ? winner.index : -1;
    this._timerEvent.remove();
    audioManager.stopBGM();

    // Online host: send final event and one last state
    if (this.isOnlineHost) {
      this._eventBuffer.push({ t: 'end', wi: this._winnerIndex });
      networkManager.sendGameState(this._serializeState());
    }

    if (winner) audioManager.playVictory();

    // Overlay
    const overlay = this.add.graphics().setDepth(100);
    overlay.fillStyle(0x000000, 0.6);
    overlay.fillRect(0, 0, GAME_WIDTH, CANVAS_HEIGHT);

    const msg   = winner ? `¡P${winner.index + 1} GANA!` : '¡EMPATE!';
    const color = winner ? `#${PLAYER_COLORS[winner.index].main.toString(16).padStart(6, '0')}` : '#ffffff';

    this.add.text(GAME_WIDTH / 2, CANVAS_HEIGHT / 2 - 40, msg, {
      fontSize: '52px', fontFamily: 'monospace',
      color, stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(101);

    this.add.text(GAME_WIDTH / 2, CANVAS_HEIGHT / 2 + 30, 'Pulsa ENTER o click para continuar', {
      fontSize: '18px', fontFamily: 'monospace', color: '#ffffff',
    }).setOrigin(0.5).setDepth(101);

    this.input.once('pointerdown',        () => this._goToMenu());
    this.input.keyboard.once('keydown-ENTER', () => this._goToMenu());
    this.input.keyboard.once('keydown-SPACE', () => this._goToMenu());
  }

  _goToMenu() {
    audioManager.stopBGM();
    this._unsubs.forEach(u => u());
    this._unsubs = [];
    if (this._spiralEvent) { this._spiralEvent.remove(); this._spiralEvent = null; }
    this.inputManager.destroy();
    this.bombManager.destroyAll();
    this.itemManager.destroyAll();
    this.scene.start(this.onlineMode ? 'LobbyScene' : 'MenuScene');
  }

  // ─── Update Loop ───────────────────────────────────────────────────────────

  update(time, delta) {
    if (this._gameOver) return;

    if (this.isOnlineClient) {
      // ── Remote-client mode ────────────────────────────────────────────────
      // Client-side prediction: local player runs their own movement
      const myInput = this.inputManager.getState(0);
      this.players[this.myPlayerIndex]?.update(delta, myInput);

      // Send inputs + authoritative client position to host
      const myPlayer = this.players[this.myPlayerIndex];
      networkManager.sendInput({
        up:          myInput.up,
        down:        myInput.down,
        left:        myInput.left,
        right:       myInput.right,
        bombJust:    myInput.bombJust,
        actionJust:  myInput.actionJust,
        x:  myPlayer ? Math.round(myPlayer.x) : 0,
        y:  myPlayer ? Math.round(myPlayer.y) : 0,
        fr: myPlayer ? (myPlayer._walkFrame || 0) : 0,
      });

      // Apply latest received state
      if (this._pendingState) {
        this._applyRemoteState(this._pendingState);
        this._pendingState = null;
      }

      // Interpolate remote players toward their extrapolated network position every frame
      for (let i = 0; i < this.players.length; i++) {
        if (i !== this.myPlayerIndex) {
          this.players[i].interpolateToNetwork(delta);
        }
      }
    } else {
      // ── Host / local-multiplayer mode ─────────────────────────────────────
      for (let i = 0; i < this.players.length; i++) {
        let input;
        if (this.isOnlineHost) {
          if (i === 0) {
            // Host controls their own player normally
            input = this.inputManager.getState(0);
            this.players[i].update(delta, input);
          } else {
            // Client-authoritative: use position reported by the client
            input = this._remoteInputs[i];
            if (input && input.x !== undefined) {
              this.players[i].sprite.setPosition(input.x, input.y);
              this.players[i]._walkFrame = input.fr || 0;
            }
            this.players[i].updateActionsOnly(delta, input || _emptyInput());
          }
        } else {
          input = this.inputManager.getState(i);
          this.players[i].update(delta, input);
        }
      }

      this.itemManager.checkPickups(this.players);
      this._checkRoundEnd();

      // Broadcast state if online host (30 hz)
      if (this.isOnlineHost) {
        this._netAccum += delta;
        if (this._netAccum >= 33) {
          this._netAccum = 0;
          networkManager.sendGameState(this._serializeState());
        }
      }
    }

    this._updateHUD();
  }

  // ─── In-game legend panel ──────────────────────────────────────────────────

  _buildInGameLegend() {
    const ITEMS = [
      { icon: '💣', name: 'Bomba extra',   desc: '+1 bomba activa',        key: 'auto'           },
      { icon: '🔥', name: 'Fuego',         desc: '+1 alcance explosión',   key: 'auto'           },
      { icon: '⚡', name: 'Velocidad',     desc: '+velocidad',             key: 'auto'           },
      { icon: '📡', name: 'Remoto',        desc: 'Detona bombas a dist',   key: 'E/Shift/O/+/Y'  },
      { icon: '➡', name: 'Penetración',   desc: 'Fuego atraviesa bloques',key: 'auto'           },
      { icon: '👟', name: 'Patada',        desc: 'Patea bombas al pasar',  key: 'auto'           },
      { icon: '💀', name: 'Maldición',     desc: 'Move aleatoria 10s',     key: '— (trampa)'     },
    ];

    const W = 340, H = 310;
    const px = (GAME_WIDTH  - W) / 2;
    const py = (CANVAS_HEIGHT - H) / 2 - 20;
    const DEPTH = 90;

    const cont = this.add.container(0, 0).setDepth(DEPTH).setVisible(false);

    const dim = this.add.graphics();
    dim.fillStyle(0x000000, 0.6);
    dim.fillRect(0, 0, GAME_WIDTH, CANVAS_HEIGHT);
    cont.add(dim);

    const panel = this.add.graphics();
    panel.fillStyle(0x0a1a30);
    panel.fillRoundedRect(px, py, W, H, 12);
    panel.lineStyle(2, 0x3366aa);
    panel.strokeRoundedRect(px, py, W, H, 12);
    cont.add(panel);

    cont.add(this.add.text(GAME_WIDTH / 2, py + 14, 'Leyenda de Ítems', {
      fontSize: '15px', fontFamily: 'monospace',
      color: '#ffdd00', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 0));

    const cellH = 34;
    const top   = py + 42;
    ITEMS.forEach((item, idx) => {
      const cy = top + idx * cellH;
      const bg = this.add.graphics();
      bg.fillStyle(idx % 2 === 0 ? 0x0f2540 : 0x0d1e35);
      bg.fillRect(px + 6, cy, W - 12, cellH - 2);
      cont.add(bg);

      cont.add(this.add.text(px + 22, cy + cellH / 2, item.icon, {
        fontSize: '18px', fontFamily: 'serif',
      }).setOrigin(0.5, 0.5));

      cont.add(this.add.text(px + 40, cy + 5, item.name, {
        fontSize: '11px', fontFamily: 'monospace', color: '#ffffaa',
      }));
      cont.add(this.add.text(px + 40, cy + 18, item.desc, {
        fontSize: '9px', fontFamily: 'monospace', color: '#aaccee',
      }));
      cont.add(this.add.text(px + W - 12, cy + cellH / 2, item.key, {
        fontSize: '8px', fontFamily: 'monospace', color: '#55ff88',
        backgroundColor: '#0a2010', padding: { x: 3, y: 2 },
      }).setOrigin(1, 0.5));
    });

    cont.add(this.add.text(GAME_WIDTH / 2, py + H - 14, 'Pulsa ESC o ℹ para cerrar', {
      fontSize: '9px', fontFamily: 'monospace', color: '#557799',
    }).setOrigin(0.5, 1));

    dim.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, CANVAS_HEIGHT),
      Phaser.Geom.Rectangle.Contains,
    ).on('pointerdown', () => {
      this._legendVisible = false;
      this._legendPanel.setVisible(false);
    });

    return cont;
  }

  // ─── Spiral close mechanic ─────────────────────────────────────────────────

  /** Returns {col,row} pairs in outer-to-inner clockwise spiral over the inner playable area. */
  _generateSpiralOrder() {
    const tiles = [];
    let top = 1, bottom = MAP_ROWS - 2, left = 1, right = MAP_COLS - 2;
    while (top <= bottom && left <= right) {
      for (let c = left;  c <= right;  c++) tiles.push({ col: c,    row: top    });
      for (let r = top+1; r <= bottom; r++) tiles.push({ col: right, row: r      });
      if (top < bottom)
        for (let c = right-1; c >= left;   c--) tiles.push({ col: c,    row: bottom });
      if (left < right)
        for (let r = bottom-1; r >= top+1; r--) tiles.push({ col: left,  row: r      });
      top++; bottom--; left++; right--;
    }
    return tiles;
  }

  _startSpiralClose() {
    if (this._spiralEvent) return;
    this._spiralTiles = this._generateSpiralOrder();
    this._spiralIndex = 0;

    const warn = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '¡EL MAPA SE CIERRA!', {
      fontSize: '28px', fontFamily: 'monospace',
      color: '#ff4400', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(95).setAlpha(0);
    this.tweens.add({
      targets: warn, alpha: { from: 0, to: 1 },
      duration: 300, yoyo: true, repeat: 4,
      onComplete: () => warn.destroy(),
    });

    this._spiralEvent = this.time.addEvent({
      delay: 600,
      callback: this._advanceSpiral,
      callbackScope: this,
      loop: true,
    });
  }

  _advanceSpiral() {
    while (this._spiralIndex < this._spiralTiles.length) {
      const { col, row } = this._spiralTiles[this._spiralIndex++];
      if (this.map[row][col] === TILE.WALL) continue;

      this.itemManager.destroyAt(col, row);

      for (const player of this.players) {
        if (!player.alive) continue;
        const pt = player.tilePos;
        if (pt.col === col && pt.row === row) {
          player.die();
          this._scheduleRespawn(player);
          if (this.isOnlineHost) this._eventBuffer.push({ t: 'death', pi: player.index });
        }
      }

      const flash = this.add.graphics().setDepth(7);
      flash.fillStyle(0xff2200, 0.85);
      flash.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      this.tweens.add({
        targets: flash, alpha: 0, duration: 400,
        onComplete: () => flash.destroy(),
      });

      this.time.delayedCall(250, () => {
        if (this._gameOver) return;
        this.map[row][col] = TILE.WALL;
        this._drawTile(col, row);
        if (this.isOnlineHost && this._lastSentMap) {
          this._lastSentMap[row][col] = -1;
        }
      });

      return;
    }
    if (this._spiralEvent) { this._spiralEvent.remove(); this._spiralEvent = null; }
  }

  // ─── Online: State Serialization (host) ───────────────────────────────────

  _serializeState() {
    // Map diff — only tiles changed since last broadcast
    const mapDiff = [];
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (this.map[r][c] !== this._lastSentMap[r][c]) {
          mapDiff.push({ c, r, t: this.map[r][c] });
          this._lastSentMap[r][c] = this.map[r][c];
        }
      }
    }

    const state = {
      sq: this._stateSeq++,
      pl: this.players.map(p => ({
        x:   Math.round(p.x),
        y:   Math.round(p.y),
        vx:  p._lastMoveVx || 0,
        vy:  p._lastMoveVy || 0,
        al:  p.alive,
        lv:  p.lives,
        mb:  p.stats.maxBombs,
        br:  p.stats.bombRange,
        sp:  p.stats.speed,
        st:  p.stunned,
        fr:  p._walkFrame || 0,
      })),
      bm:  this.bombManager.serialize(),
      it:  [...this.itemManager.items.values()].map(i => ({ c: i.col, r: i.row, tp: i.type })),
      md:  mapDiff,
      ev:  this._eventBuffer.splice(0), // drain event buffer
      go:  this._gameOver,
      wi:  this._winnerIndex,
    };

    return state;
  }

  // ─── Online: State Application (client) ───────────────────────────────────

  _applyRemoteState(state) {
    // 1. Apply map diffs (blocks destroyed)
    if (state.md) {
      for (const { c, r, t } of state.md) {
        if (this.map[r]?.[c] !== t) {
          this.map[r][c] = t;
          this._drawTile(c, r);
        }
      }
    }

    // 2. Process one-time events (explosions, sounds)
    if (state.ev) {
      for (const ev of state.ev) {
        if (ev.t === 'explode') {
          // Compute tiles from updated map and spawn visuals
          const tiles = calcExplosionTiles(this.map, ev.col, ev.row, ev.range, ev.pierce);
          for (const { col, row, type } of tiles) {
            this._spawnExplosionVisual(col, row, type);
          }
          audioManager.playExplosion(ev.range);
        } else if (ev.t === 'death') {
          audioManager.playPlayerDeath();
        } else if (ev.t === 'pickup') {
          audioManager.playItemPickup();
        } else if (ev.t === 'end' && !this._gameOver) {
          this._endRound(ev.wi >= 0 ? this.players[ev.wi] : null);
        }
      }
    }

    // 3. Update players
    if (state.pl) {
      state.pl.forEach((ps, i) => {
        const p = this.players[i];
        if (!p) return;

        if (i !== this.myPlayerIndex) {
          // Other players: interpolate toward authoritative position
          if (ps.al) {
            p.setNetworkTarget(ps.x, ps.y, ps.vx || 0, ps.vy || 0, ps.sp || 160);
            // Snap immediately on respawn (avoid sliding from death tile)
            if (!p.alive) {
              p.sprite.setPosition(ps.x, ps.y);
              p.sprite.setAlpha(1);
              p.sprite.setDepth(10);
              p.label.setPosition(ps.x, ps.y - 28);
              p.label.setAlpha(1);
            }
            p.sprite.setTexture(`player_${i}_walk_${ps.fr}`);
          } else {
            // Dead: snap directly, no interpolation needed
            p.sprite.setPosition(ps.x, ps.y);
            p.label.setPosition(ps.x, ps.y - 28);
            if (p.alive && !ps.al) {
              p.sprite.setTexture(`player_${i}_dead`);
              p.sprite.setAlpha(0.6);
              p.sprite.setDepth(1);
              p.label.setAlpha(0.3);
            }
          }
        } else {
          // Own player: client is authoritative for position.
          // Only apply state transitions (death / respawn), never snap during movement.
          if (p.alive && !ps.al) {
            // Host confirmed death
            p.sprite.setTexture(`player_${i}_dead`);
            p.sprite.setAlpha(0.6);
            p.sprite.setDepth(1);
            p.label.setAlpha(0.3);
          } else if (!p.alive && ps.al) {
            // Host confirmed respawn — snap to spawn point and flash
            p.sprite.setPosition(ps.x, ps.y);
            p.sprite.setTexture(`player_${i}_idle`);
            p.sprite.setAlpha(1);
            p.sprite.setDepth(10);
            p.sprite.clearTint();
            p.label.setAlpha(1);
            p.label.setPosition(ps.x, ps.y - 28);
            this.tweens.add({
              targets: p.sprite, alpha: { from: 0.3, to: 1 },
              duration: 200, repeat: 6, yoyo: true,
              onComplete: () => { if (p.sprite.active) p.sprite.setAlpha(1); },
            });
          }
          // No position reconciliation — client position is never overridden
        }

        p.alive           = ps.al;
        p.lives           = ps.lv;
        p.stats.maxBombs  = ps.mb;
        p.stats.bombRange = ps.br;
        p.stats.speed     = ps.sp;
        p.stunned         = ps.st;
      });
    }

    // 4. Reconcile bomb sprites (no timer logic — just visual presence)
    if (state.bm) {
      const newSet = new Set(state.bm.map(b => `${b.col},${b.row}`));

      for (const [key, spr] of this._clientBombSprites) {
        if (!newSet.has(key)) {
          if (spr.active) spr.destroy();
          this._clientBombSprites.delete(key);
        }
      }

      for (const { col, row } of state.bm) {
        const key = `${col},${row}`;
        if (!this._clientBombSprites.has(key)) {
          const pos = tileToPixel(col, row, TILE_SIZE);
          const spr = this.add.sprite(pos.x, pos.y, 'bomb').setDepth(5);
          this.tweens.add({
            targets: spr, scaleX: 1.15, scaleY: 1.15,
            duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
          });
          this._clientBombSprites.set(key, spr);
        }
      }
    }

    // 5. Reconcile items
    if (state.it) {
      const newItemSet = new Set(state.it.map(i => `${i.c},${i.r}`));
      for (const [key, item] of this.itemManager.items) {
        if (!newItemSet.has(key)) this.itemManager.removeItem(item.col, item.row);
      }
      for (const { c, r, tp } of state.it) {
        if (!this.itemManager.items.has(`${c},${r}`)) {
          this.itemManager.forceSpawn(c, r, tp);
        }
      }
    }

    // 6. Game over from host
    if (state.go && !this._gameOver) {
      this._endRound(state.wi >= 0 ? this.players[state.wi] : null);
    }
  }

  /** Spawn explosion visual only (no game logic — used by remote clients) */
  _spawnExplosionVisual(col, row, type) {
    const pos    = tileToPixel(col, row, TILE_SIZE);
    const sprite = this.add.sprite(pos.x, pos.y, `explosion_${type}`).setDepth(8);
    this.tweens.add({
      targets: sprite, alpha: 0, scaleX: 1.3, scaleY: 1.3,
      duration: EXPLOSION_DURATION, ease: 'Power2',
      onComplete: () => sprite.destroy(),
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _emptyInput() {
  return { up: false, down: false, left: false, right: false, bombJust: false, actionJust: false };
}
