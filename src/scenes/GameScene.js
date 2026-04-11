import {
  TILE_SIZE, TILE, MAP_COLS, MAP_ROWS,
  GAME_WIDTH, GAME_HEIGHT, HUD_HEIGHT, CANVAS_HEIGHT,
  PLAYER_COLORS, SPAWN_POSITIONS, RESPAWN_DELAY,
  DEFAULT_CHARACTER_ID,
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
import { preloadCharacterSets, normalizeCharacterId } from '../utils/CharacterAssets.js';

const WILL_E_MISSILE_TRAVEL_MS = 2000;
const WILL_E_MISSILE_RANGE = 1;

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  init(data) {
    this.playerCount      = data.playerCount    || 2;
    this.onlineMode       = data.online         || false;
    this.isOnlineHost     = data.isHost         || false;
    this.isOnlineClient   = this.onlineMode && !this.isOnlineHost;
    this.myPlayerIndex    = data.myPlayerIndex  ?? 0;
    this._seed            = data.seed           ?? null;
    this._itemConfig      = data.itemConfig     ?? null;
    this._playerNames     = Array.isArray(data.playerNames) ? data.playerNames : [];
    this._playerProfiles  = Array.isArray(data.playerProfiles) ? data.playerProfiles : [];
    if (!this._playerProfiles.length && this._playerNames.length) {
      this._playerProfiles = this._playerNames.map((name) => ({
        name,
        characterId: DEFAULT_CHARACTER_ID,
      }));
    }
    this._unsubs          = [];
    this._goingToLobby    = false;
    this._pendingLobbyData = null;
    this._willEMissiles = new Map();
    this._willEMissileSeq = 0;
  }

  preload() {
    preloadCharacterSets(this);
  }

  create() {
    audioManager.init();

    // Generate all procedural textures
    generateAssets(this);

    // Build map — use seeded RNG when in online mode so all clients share same map
    const rng = this._seed !== null ? createRng(this._seed) : Math.random;
    this.map     = generateMap(0.8, rng);
    this.tilemap = [];

    // Online host: track map changes for diff broadcast
    if (this.isOnlineHost) {
      this._lastSentMap = this.map.map(r => [...r]);
      this._stateSeq    = 0;
      this._fullMapSyncEvery = 120; // send full map snapshot roughly every 2 seconds at 60hz
      this._netAccum    = 0;
      this._eventBuffer = [];
      this._remoteInputs    = {};
      this._remotePositions = {};
    }

    // Online client: bomb sprites managed separately (no timer logic)
    if (this.isOnlineClient) {
      this._clientBombSprites = new Map(); // key: 'col,row' → { sprite, textureKey }
      this._pendingState = null;
    }

    // ── Systems ──────────────────────────────────────────────────────────────
    this.itemManager = new ItemManager(this, this._itemConfig);

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
        // Kill all players on this tile — collect first so simultaneous deaths
        // are all registered before _checkRoundEnd runs.
        const dying = [];
        for (const player of this.players) {
          if (!player.alive) continue;
          const pt = player.tilePos;
          if (pt.col !== col || pt.row !== row) continue;
          if (owner && player.isImmuneToExplosion?.(owner)) continue;
          dying.push(player);
        }
        for (const player of dying) {
          const wasAlive = player.alive;
          player.die();
          if (wasAlive && !player.alive && player.shouldDropInventoryOnDeath?.()) {
            this._dropPlayerInventory(player);
          }
        }
        for (const player of dying) this._scheduleRespawn(player);
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
      const profile = this._playerProfiles[i] || {
        name: this._playerNames[i] || `P${i + 1}`,
        characterId: DEFAULT_CHARACTER_ID,
      };
      const safeProfile = {
        name: String(profile.name || `P${i + 1}`).trim().slice(0, 12) || `P${i + 1}`,
        characterId: normalizeCharacterId(profile.characterId),
      };
      const p = new Player(this, i, this.map, this.bombManager, safeProfile);
      this.players.push(p);
      // Online host: hook player events into event buffer
      if (this.isOnlineHost) {
        p.onEvent = (ev) => this._eventBuffer.push(ev);
      }
    }

    // Character duplicate visual filter: only activate when there are repeated picks.
    const byCharacter = new Map();
    for (const p of this.players) {
      const n = byCharacter.get(p.characterId) || 0;
      byCharacter.set(p.characterId, n + 1);
    }
    for (const p of this.players) {
      const hasDuplicate = (byCharacter.get(p.characterId) || 0) > 1;
      const color = PLAYER_COLORS[p.index % PLAYER_COLORS.length]?.main;
      p.setDuplicateFilter(hasDuplicate, color);
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
          const prev = this._remoteInputs[playerIndex] || {};
          const hasKickNow = !!(inputs.kx || inputs.ky);
          const hadKickLatched = !!(prev.kx || prev.ky);
          // Latch one-shot flags: keep true until the host update loop consumes them
          this._remoteInputs[playerIndex] = {
            ...inputs,
            action1Just: inputs.action1Just || !!prev.action1Just,
            action2Just: inputs.action2Just || !!prev.action2Just,
            action3Just: inputs.action3Just || !!prev.action3Just,
            action4Just: inputs.action4Just || !!prev.action4Just,
            // legacy aliases for compatibility with transitional clients
            bombJust:   inputs.bombJust   || !!prev.bombJust || inputs.action2Just,
            actionJust: inputs.actionJust || !!prev.actionJust || inputs.action3Just,
            kx:         inputs.kx || prev.kx || 0,
            ky:         inputs.ky || prev.ky || 0,
            // Preserve both tile coordinates while a kick is latched.
            // Horizontal kicks still need row, vertical kicks still need col.
            kc:         hasKickNow ? inputs.kc : (hadKickLatched ? prev.kc : undefined),
            kr:         hasKickNow ? inputs.kr : (hadKickLatched ? prev.kr : undefined),
          };
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

    if (this.onlineMode) {
      this._unsubs.push(
        networkManager.on('host_left', () => {
          if (this._gameOver) return; // already handled in _endRound
          this._cleanupSystems();
          networkManager.disconnect();
          this.scene.start('MenuScene');
        }),
        networkManager.on('return_to_lobby', (data) => {
          // Store data; actual transition happens in update() inside Phaser loop
          if (!this.isOnlineHost) {
            this._pendingLobbyData = data;
          }
        }),
      );
    }

    this._gameOver = false;
    this._winnerIndex = undefined;
    this._winnerName = '';
    this._spiralStarted = false;
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

      const player = this.players[i];
      const charLabel = String(player?.characterId || DEFAULT_CHARACTER_ID).toUpperCase();
      const charText = this.add.text(x + 48, y, charLabel, {
        fontSize: '9px', fontFamily: 'monospace',
        color: '#9ad6ff',
      }).setDepth(51);

      // Lives
      const livesText = this.add.text(x, y + 30, '♥♥♥', {
        fontSize: '12px', fontFamily: 'monospace',
        color: '#ff4466',
      }).setDepth(51);

      // Bombs
      const bombText = this.add.text(x + 50, y + 30, '💣1', {
        fontSize: '11px', fontFamily: 'monospace',
        color: '#ffdd00',
      }).setDepth(51);

      // Range
      const rangeText = this.add.text(x + 85, y + 30, '🔥2', {
        fontSize: '11px', fontFamily: 'monospace',
        color: '#ff8800',
      }).setDepth(51);

      this._hudEntries.push({ livesText, bombText, rangeText, charText });
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
    if (!player) return;
    if (player.hasPendingSelfRevive?.()) return;
    if (player.lives <= 0) {
      this._checkRoundEnd();
      return;
    }
    this.time.delayedCall(RESPAWN_DELAY, () => {
      if (!this._gameOver) player.respawn();
    });
  }

  _dropPlayerInventory(player) {
    if (player?.shouldDropInventoryOnDeath && !player.shouldDropInventoryOnDeath()) return;
    if (!player || !player.extractInventoryDrops) return;
    const drops = player.extractInventoryDrops();
    if (!drops.length) return;
    this.itemManager.dropInventoryItems(drops);
  }

  _playResurrectionEffect(x, y, isBony = false) {
    const outerColor = isBony ? 0x9bf6ff : 0x9cff9c;
    const innerColor = isBony ? 0xdffcff : 0xe5ffe5;
    const ringA = this.add.circle(x, y, TILE_SIZE * 0.34, outerColor, 0.42).setDepth(19);
    const ringB = this.add.circle(x, y, TILE_SIZE * 0.22, innerColor, 0.62).setDepth(19);

    this.tweens.add({
      targets: [ringA, ringB],
      scale: { from: 0.42, to: 1.85 },
      alpha: { from: 0.78, to: 0 },
      duration: 500,
      ease: 'Cubic.Out',
      onComplete: () => {
        ringA.destroy();
        ringB.destroy();
      },
    });
  }

  _crushOccupantsInWalls() {
    // Any item enclosed by newly-created wall tiles is removed immediately.
    for (const item of [...this.itemManager.items.values()]) {
      if (this.map[item.row]?.[item.col] === TILE.WALL) {
        this.itemManager.removeItem(item.col, item.row);
      }
    }

    const dying = [];
    for (const player of this.players) {
      if (!player.alive) continue;
      const pt = player.tilePos;
      if (this.map[pt.row]?.[pt.col] !== TILE.WALL) continue;
      const wasAlive = player.alive;
      player.die();
      if (wasAlive && !player.alive) {
        if (player.shouldDropInventoryOnDeath?.()) {
          this._dropPlayerInventory(player);
        }
        dying.push(player);
      }
    }

    for (const player of dying) this._scheduleRespawn(player);
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
    this._winnerName = winner ? (winner.displayName || `P${winner.index + 1}`) : '';
    this._spiralStarted = false;
    this._clearWillEMissiles();
    if (this._timerEvent) { this._timerEvent.remove(); this._timerEvent = null; }
    if (this._spiralEvent) { this._spiralEvent.remove(); this._spiralEvent = null; }
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

    const msg   = winner ? `¡${this._winnerName} GANA!` : '¡EMPATE!';
    const color = winner ? `#${PLAYER_COLORS[winner.index].main.toString(16).padStart(6, '0')}` : '#ffffff';

    this.add.text(GAME_WIDTH / 2, CANVAS_HEIGHT / 2 - 40, msg, {
      fontSize: '52px', fontFamily: 'monospace',
      color, stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(101);

    if (this.onlineMode) {
      this.add.text(GAME_WIDTH / 2, CANVAS_HEIGHT / 2 + 30, 'Pulsa ENTER o click para volver al lobby', {
        fontSize: '18px', fontFamily: 'monospace', color: '#ffffff',
      }).setOrigin(0.5).setDepth(101);

      let done = false;
      const doReturn = () => {
        if (done) return; done = true;
        window.removeEventListener('keydown', onKey);
        if (this.isOnlineHost) {
          // Host notifies server (resets room.started + broadcasts to clients)
          networkManager.returnToLobby({
            winnerIndex: this._winnerIndex,
            winnerName: this._winnerName,
          });
        }
        this._goToLobby({
          roomCode:    networkManager.roomCode,
          players:     networkManager.lastPlayers,
          playerCount: networkManager.lastPlayers.length,
          started:     false,
        });
      };
      const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') doReturn(); };
      window.addEventListener('keydown', onKey);
      this.input.once('pointerdown', () => {
        window.removeEventListener('keydown', onKey);
        doReturn();
      });
      this._unsubs.push(() => window.removeEventListener('keydown', onKey));
    } else {
      this.add.text(GAME_WIDTH / 2, CANVAS_HEIGHT / 2 + 30, 'Pulsa ENTER o click para continuar', {
        fontSize: '18px', fontFamily: 'monospace', color: '#ffffff',
      }).setOrigin(0.5).setDepth(101);

      let done = false;
      const goMenu = () => { if (done) return; done = true; window.removeEventListener('keydown', onLocalKey); this._goToMenu(); };
      const onLocalKey = (e) => { if (e.key === 'Enter' || e.key === ' ') goMenu(); };
      window.addEventListener('keydown', onLocalKey);
      this.input.once('pointerdown', goMenu);
      this._unsubs.push(() => window.removeEventListener('keydown', onLocalKey));
    }
  }

  _goToMenu() {
    audioManager.stopBGM();
    this._cleanupSystems();
    this.scene.start('MenuScene');
  }

  _goToLobby(roomData) {
    if (this._goingToLobby) return;
    this._goingToLobby = true;
    audioManager.stopBGM();
    this._cleanupSystems();
    this.scene.start('LobbyScene', { returning: true, roomData });
  }

  _cleanupSystems() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
    if (this._spiralEvent) { this._spiralEvent.remove(); this._spiralEvent = null; }
    this._clearWillEMissiles();
    this.inputManager.destroy();
    this.bombManager.destroyAll();
    this.itemManager.destroyAll();
  }

  // ─── Will-e Ability ───────────────────────────────────────────────────────

  tryLaunchWillEMissile(owner) {
    if (!owner || owner.characterId !== 'will-e') return false;
    if (this._gameOver) return false;

    // Online clients are not authoritative for ability effects.
    if (this.isOnlineClient) return false;

    const rivals = (this.players || []).filter(
      (p) => p && p !== owner && p.alive && p.sprite?.active,
    );
    if (!rivals.length) return false;

    const target = Phaser.Utils.Array.GetRandom(rivals);
    const { col, row } = target.tilePos;
    const startX = owner.x;
    const startY = owner.y;
    const targetPos = tileToPixel(col, row, TILE_SIZE);
    const id = `wm_${Math.round(this.time.now)}_${owner.index}_${this._willEMissileSeq++}`;

    this._createWillEMissile({
      id,
      ownerIndex: owner.index,
      startX,
      startY,
      targetCol: col,
      targetRow: row,
      targetX: targetPos.x,
      targetY: targetPos.y,
      durationMs: WILL_E_MISSILE_TRAVEL_MS,
      resolveImpact: true,
    });

    if (this.isOnlineHost) {
      this._eventBuffer.push({
        t: 'wm_launch',
        id,
        pi: owner.index,
        sx: Math.round(startX),
        sy: Math.round(startY),
        tc: col,
        tr: row,
        tx: targetPos.x,
        ty: targetPos.y,
        ms: WILL_E_MISSILE_TRAVEL_MS,
      });
    }

    return true;
  }

  _createWillEMissile({
    id,
    ownerIndex,
    startX,
    startY,
    targetCol,
    targetRow,
    targetX,
    targetY,
    durationMs = WILL_E_MISSILE_TRAVEL_MS,
    resolveImpact = false,
  }) {
    if (!id || this._willEMissiles.has(id)) return false;

    const warningTile = this.add.rectangle(
      targetX,
      targetY,
      TILE_SIZE - 6,
      TILE_SIZE - 6,
      0xff4a2a,
      0.26,
    ).setDepth(11);
    warningTile.setStrokeStyle(2, 0xffcc7a, 0.95);

    const warningText = this.add.text(targetX, targetY, `${Math.ceil(durationMs / 1000)}s`, {
      fontSize: '16px',
      fontFamily: 'monospace',
      color: '#ffe680',
      stroke: '#3a1000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(12);

    const missileBody = this.add.circle(startX, startY, 6, 0xfff0a8, 1).setDepth(14);
    const missileCore = this.add.circle(startX, startY, 3, 0xff5a22, 1).setDepth(15);

    const warningPulse = this.tweens.add({
      targets: warningTile,
      alpha: { from: 0.2, to: 0.45 },
      duration: 190,
      yoyo: true,
      repeat: -1,
    });
    const warningTextPulse = this.tweens.add({
      targets: warningText,
      scale: { from: 1, to: 1.16 },
      duration: 220,
      yoyo: true,
      repeat: -1,
    });
    const missilePulse = this.tweens.add({
      targets: missileBody,
      scale: { from: 0.9, to: 1.1 },
      duration: 110,
      yoyo: true,
      repeat: -1,
    });

    this._willEMissiles.set(id, {
      id,
      ownerIndex,
      startX,
      startY,
      targetCol,
      targetRow,
      targetX,
      targetY,
      durationMs,
      elapsedMs: 0,
      shownSeconds: Math.ceil(durationMs / 1000),
      resolveImpact,
      warningTile,
      warningText,
      missileBody,
      missileCore,
      warningPulse,
      warningTextPulse,
      missilePulse,
    });
    return true;
  }

  _updateWillEMissiles(delta) {
    if (!this._willEMissiles.size) return;

    for (const missile of [...this._willEMissiles.values()]) {
      missile.elapsedMs += delta;

      const progress = Phaser.Math.Clamp(missile.elapsedMs / missile.durationMs, 0, 1);
      const eased = Phaser.Math.Easing.Cubic.InOut(progress);
      const x = Phaser.Math.Linear(missile.startX, missile.targetX, eased);
      const y = Phaser.Math.Linear(missile.startY, missile.targetY, eased);

      if (missile.missileBody?.active) missile.missileBody.setPosition(x, y);
      if (missile.missileCore?.active) missile.missileCore.setPosition(x, y);

      const remainingMs = Math.max(0, missile.durationMs - missile.elapsedMs);
      const secondsLeft = Math.ceil(remainingMs / 1000);
      if (secondsLeft > 0 && secondsLeft !== missile.shownSeconds && missile.warningText?.active) {
        missile.shownSeconds = secondsLeft;
        missile.warningText.setText(`${secondsLeft}s`);
      }

      if (progress < 1) continue;

      if (missile.resolveImpact && !this.isOnlineClient) {
        const owner = this.players[missile.ownerIndex] || null;
        this.bombManager.createExplosion(
          missile.targetCol,
          missile.targetRow,
          WILL_E_MISSILE_RANGE,
          false,
          owner,
        );
      }

      this._destroyWillEMissile(missile.id);
    }
  }

  _destroyWillEMissile(id) {
    const missile = this._willEMissiles.get(id);
    if (!missile) return;

    const tweens = [missile.warningPulse, missile.warningTextPulse, missile.missilePulse];
    for (const tw of tweens) {
      if (!tw) continue;
      tw.stop();
      tw.remove();
    }

    missile.warningTile?.destroy?.();
    missile.warningText?.destroy?.();
    missile.missileBody?.destroy?.();
    missile.missileCore?.destroy?.();

    this._willEMissiles.delete(id);
  }

  _clearWillEMissiles() {
    for (const id of [...this._willEMissiles.keys()]) {
      this._destroyWillEMissile(id);
    }
  }

  castDracarysFlame(owner) {
    if (!owner || owner.characterId !== 'dracarys') return false;
    if (this._gameOver) return false;

    // Online clients are not authoritative for ability effects.
    if (this.isOnlineClient) return false;

    const { col: originCol, row: originRow } = owner.tilePos;
    const facingDelta = {
      up: [0, -1],
      down: [0, 1],
      left: [-1, 0],
      right: [1, 0],
    };
    const [dc, dr] = facingDelta[owner._facing] || [0, 1];
    const maxRange = Math.max(MAP_COLS, MAP_ROWS);
    const tiles = [];

    for (let i = 1; i <= maxRange; i++) {
      const c = originCol + dc * i;
      const r = originRow + dr * i;
      if (c < 0 || c >= MAP_COLS || r < 0 || r >= MAP_ROWS) break;

      const tile = this.map[r][c];
      if (tile === TILE.WALL) break;

      const nextC = c + dc;
      const nextR = r + dr;
      const nextOut = nextC < 0 || nextC >= MAP_COLS || nextR < 0 || nextR >= MAP_ROWS;
      const nextTile = nextOut ? TILE.WALL : this.map[nextR][nextC];
      const isEnd = i === maxRange || tile === TILE.BLOCK || nextOut || nextTile === TILE.WALL;

      let type;
      if (dc !== 0) {
        type = isEnd ? (dc > 0 ? 'end_right' : 'end_left') : 'middle_h';
      } else {
        type = isEnd ? (dr > 0 ? 'end_down' : 'end_up') : 'middle_v';
      }

      tiles.push({ col: c, row: r, type });
      if (tile === TILE.BLOCK) break;
    }

    if (!tiles.length) return false;

    audioManager.playExplosion(maxRange);

    const destroyedBlocks = [];
    for (const { col, row } of tiles) {
      if (this.map[row]?.[col] === TILE.BLOCK) {
        this.map[row][col] = TILE.FLOOR;
        audioManager.playBlockDestroyed();
        destroyedBlocks.push({ col, row });
      }
    }

    for (const { col, row, type } of tiles) {
      this._spawnExplosionVisual(col, row, type);
      if (this.bombManager.onExplosionHit) this.bombManager.onExplosionHit(col, row, owner);
      const chainBomb = this.bombManager.bombs.get(`${col},${row}`);
      if (chainBomb) this.time.delayedCall(80, () => chainBomb.detonate());
    }

    for (const { col, row } of destroyedBlocks) {
      if (this.bombManager.onBlockDestroyed) this.bombManager.onBlockDestroyed(col, row);
    }

    if (this.isOnlineHost) {
      this._eventBuffer.push({
        t: 'explode',
        col: originCol,
        row: originRow,
        range: maxRange,
        pierce: false,
        tiles,
      });
    }

    return true;
  }

  // ─── Update Loop ───────────────────────────────────────────────────────────

  update(time, delta) {
    // Handle lobby return even after game over (transition must run inside Phaser loop)
    if (this._pendingLobbyData) {
      const d = this._pendingLobbyData;
      this._pendingLobbyData = null;
      this._goToLobby(d);
      return;
    }

    if (this._gameOver) return;

    if (this.isOnlineClient) {
      // ── Remote-client mode ────────────────────────────────────────────────
      // Client-side prediction: local player runs their own movement
      const myInput = this.inputManager.getState(0);
      this.players[this.myPlayerIndex]?.update(delta, myInput);

      // Send inputs + authoritative client position to host
      const myPlayer = this.players[this.myPlayerIndex];
      const pendingKick = myPlayer ? myPlayer._pendingKick : null;
      if (myPlayer) myPlayer._pendingKick = null;
      networkManager.sendInput({
        up:          myInput.up,
        down:        myInput.down,
        left:        myInput.left,
        right:       myInput.right,
        mv:          myPlayer ? ((Math.abs(myPlayer._lastMoveVx || 0) > 0.01 || Math.abs(myPlayer._lastMoveVy || 0) > 0.01) ? 1 : 0) : 0,
        mvx:         myPlayer ? (myPlayer._lastMoveVx || 0) : 0,
        mvy:         myPlayer ? (myPlayer._lastMoveVy || 0) : 0,
        action1Just: myInput.action1Just,
        action2Just: myInput.action2Just,
        action3Just: myInput.action3Just,
        action4Just: myInput.action4Just,
        bombJust:    myInput.bombJust,
        actionJust:  myInput.actionJust,
        fac:         myPlayer ? myPlayer._facing : 'down',
        kx:          pendingKick ? pendingKick.dx  : 0,
        ky:          pendingKick ? pendingKick.dy  : 0,
        kc:          pendingKick ? pendingKick.col : 0,
        kr:          pendingKick ? pendingKick.row : 0,
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
            // Copy input so we can clear the latched flags in storage BEFORE processing,
            // preventing bombJust/actionJust from firing again on the next host frame.
            const rp = this.players[i];
            const prevX = rp.x;
            const prevY = rp.y;
            const stored = this._remoteInputs[i];
            input = stored ? { ...stored } : null;
            if (stored) {
              stored.action1Just = false;
              stored.action2Just = false;
              stored.action3Just = false;
              stored.action4Just = false;
              stored.bombJust = false;
              stored.actionJust = false;
              stored.kx = 0;
              stored.ky = 0;
              stored.kc = undefined;
              stored.kr = undefined;
            }
            if (input && input.x !== undefined && !rp._isMovementLocked?.()) {
              rp.sprite.setPosition(input.x, input.y);
              rp._walkFrame = input.fr || 0;

              const dx = input.x - prevX;
              const dy = input.y - prevY;
              const mag = Math.hypot(dx, dy);
              if (typeof input.mvx === 'number' || typeof input.mvy === 'number') {
                rp._lastMoveVx = input.mvx || 0;
                rp._lastMoveVy = input.mvy || 0;
              } else if (mag > 0.0001) {
                rp._lastMoveVx = dx / mag;
                rp._lastMoveVy = dy / mag;
              } else {
                rp._lastMoveVx = 0;
                rp._lastMoveVy = 0;
              }
            } else {
              rp._lastMoveVx = 0;
              rp._lastMoveVy = 0;
            }
            // Apply facing so multi-bomb fires in the correct direction
            if (input && input.fac) rp._facing = input.fac;

            if (rp.alive) {
              const movementLocked = !!rp._isMovementLocked?.();
              const movedNow = !!(
                !movementLocked && (input && (input.mv || input.up || input.down || input.left || input.right))
                || Math.abs(rp._lastMoveVx) > 0.01
                || Math.abs(rp._lastMoveVy) > 0.01
              );
              if (rp._remoteAnimHold === undefined) rp._remoteAnimHold = 0;
              if (movedNow) rp._remoteAnimHold = 140;
              else rp._remoteAnimHold = Math.max(0, rp._remoteAnimHold - delta);
              const moved = rp._remoteAnimHold > 0;
              if (moved) rp._setWalkTexture();
              else rp._setIdleTexture();
            }

            rp.updateActionsOnly(delta, input || _emptyInput());
          }
        } else {
          input = this.inputManager.getState(i);
          this.players[i].update(delta, input);
        }
      }

      this.itemManager.checkPickups(this.players);
      if (this._spiralStarted) this._crushOccupantsInWalls();
      this._checkRoundEnd();

      // Broadcast state if online host (60 hz)
      if (this.isOnlineHost) {
        this._netAccum += delta;
        if (this._netAccum >= 16) {
          this._netAccum = 0;
          networkManager.sendGameState(this._serializeState());
        }
      }
    }

    this._updateWillEMissiles(delta);
    this._updateHUD();
  }

  // ─── In-game legend panel ──────────────────────────────────────────────────

  _buildInGameLegend() {
    const ITEMS = [
      { icon: '💣', name: 'Bomba extra',    desc: '+1 bomba activa (máx 6)',   key: 'auto'          },
      { icon: '🔥', name: 'Fuego',          desc: '+1 alcance explosión',      key: 'auto'          },
      { icon: '⚡', name: 'Velocidad',      desc: '+velocidad',                key: 'auto'          },
      { icon: '💥', name: 'Multi-bomba',    desc: 'Bombas en la dirección que miras', key: '3 (H / L / botón 3)' },
      { icon: '👟', name: 'Patada',         desc: 'Patea bombas al pasar',     key: 'auto'          },
      { icon: '💀', name: 'Maldición',      desc: 'Aleatoria: movimiento aleatorio o invertido (10s)',  key: '— (trampa)'    },
      { icon: '🌀', name: 'Enganche',       desc: 'Saldrás disparado hasta la pared', key: '— (trampa)'    },
    ];

    const W = 340, H = 350;
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

    cont.add(this.add.text(GAME_WIDTH / 2, py + 12, 'Leyenda de Ítems', {
      fontSize: '15px', fontFamily: 'monospace',
      color: '#ffdd00', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 0));

    cont.add(this.add.text(GAME_WIDTH / 2, py + 32,
      'Acciones: 1=habilidad (J/;) | 2=bomba (K/\') | 3=item (H/L) | 4=sin uso (U/P)', {
        fontSize: '8px', fontFamily: 'monospace', color: '#9bc8e7',
      }).setOrigin(0.5, 0));

    cont.add(this.add.text(GAME_WIDTH / 2, py + 43,
      'Móvil: cruz táctil 1 abajo, 2 derecha, 3 izquierda, 4 arriba', {
        fontSize: '8px', fontFamily: 'monospace', color: '#7eb0d1',
      }).setOrigin(0.5, 0));

    const cellH = 34;
    const top   = py + 60;
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
    if (this._spiralStarted) return;
    this._spiralStarted = true;

    // Timer no longer matters once the spiral starts — stop it so it can't
    // trigger _endRound(null) at t=0 while players wait to respawn.
    if (this._timerEvent) {
      this._timerEvent.remove();
      this._timerEvent = null;
    }
    this._timerText.setText('💀');
    this._timerText.setStyle({ color: '#ff4444' });

    const warn = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '¡EL MAPA SE CIERRA!', {
      fontSize: '28px', fontFamily: 'monospace',
      color: '#ff4400', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(95).setAlpha(0);
    this.tweens.add({
      targets: warn, alpha: { from: 0, to: 1 },
      duration: 300, yoyo: true, repeat: 4,
      onComplete: () => warn.destroy(),
    });

    // Guests only mirror HUD/phase state; host remains authoritative for
    // actual spiral wall placement and damage.
    if (this.isOnlineClient) return;

    this._spiralTiles = this._generateSpiralOrder();
    this._spiralIndex = 0;

    this._spiralEvent = this.time.addEvent({
      delay: Math.round(600 / 1.5),
      callback: this._advanceSpiral,
      callbackScope: this,
      loop: true,
    });
  }

  _advanceSpiral() {
    while (this._spiralIndex < this._spiralTiles.length) {
      const { col, row } = this._spiralTiles[this._spiralIndex++];
      if (this.map[row][col] === TILE.WALL) continue;

      // Closing walls destroy anything already on that tile, including bounty items.
      if (this.itemManager.items.has(`${col},${row}`)) {
        this.itemManager.removeItem(col, row);
      }

      // Collect all players on this tile before processing deaths so that
      // simultaneous kills (e.g. two players on same tile) are all registered
      // before _checkRoundEnd runs — otherwise the first death incorrectly
      // declares the second player the winner.
      const dying = [];
      for (const player of this.players) {
        if (!player.alive) continue;
        const pt = player.tilePos;
        if (pt.col === col && pt.row === row) dying.push(player);
      }
      for (const player of dying) {
        const wasAlive = player.alive;
        player.die();
        if (wasAlive && !player.alive && player.shouldDropInventoryOnDeath?.()) {
          this._dropPlayerInventory(player);
        }
      }
      for (const player of dying) {
        this._scheduleRespawn(player);
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
        audioManager.playMapCloseHit();
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
    const seq = this._stateSeq++;
    const includeFullMap = (seq % this._fullMapSyncEvery) === 0;

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
      sq: seq,
      mf: includeFullMap ? this.map.map((row) => row.join('')) : undefined,
      pl: this.players.map(p => ({
        x:   Math.round(p.x),
        y:   Math.round(p.y),
        ch:  p.characterId,
        bt:  p._bombyTransformed || false,
        vx:  p._lastMoveVx || 0,
        vy:  p._lastMoveVy || 0,
        fd:  p._facing || 'down',
        al:  p.alive,
        lv:  p.lives,
        mb:  p.stats.maxBombs,
        br:  p.stats.bombRange,
        sp:  p.stats.speed,
        st:  p.stunned,
        rv:  p._reverseControls || false,
        ra:  p._rushActive   || false,
        rp:  p._rushPending  || false,
        dc:  p._dracarysCharging || false,
        ac:  Math.max(0, Math.ceil(p._abilityCooldownRemaining || 0)),
        ki:  p.stats.kick    || false,
        ms:  p.stats.multiStar || false,
        fr:  p._walkFrame || 0,
      })),
      bm:  this.bombManager.serialize(),
      it:  [...this.itemManager.items.values()].map(i => ({ c: i.col, r: i.row, tp: i.type })),
      md:  mapDiff,
      ev:  this._eventBuffer.splice(0), // drain event buffer
      sp:  this._spiralStarted,
      go:  this._gameOver,
      wi:  this._winnerIndex,
    };

    return state;
  }

  // ─── Online: State Application (client) ───────────────────────────────────

  _applyRemoteState(state) {
    // Host entered spiral close: guests must stop local timer countdown
    // immediately and switch HUD to closure state.
    if (state.sp && !this._spiralStarted) {
      this._startSpiralClose();
    }

    // 1. Full map snapshot (periodic host resync)
    if (Array.isArray(state.mf) && state.mf.length === MAP_ROWS) {
      for (let r = 0; r < MAP_ROWS; r++) {
        const rowStr = String(state.mf[r] || '');
        for (let c = 0; c < MAP_COLS; c++) {
          const next = Number(rowStr[c]);
          if (!Number.isFinite(next)) continue;
          const prev = this.map[r]?.[c];
          if (prev !== next) {
            this.map[r][c] = next;
            this._drawTile(c, r);
            if (this._spiralStarted && prev !== TILE.WALL && next === TILE.WALL) {
              audioManager.playMapCloseHit();
            }
          }
        }
      }
    }

    // 2. Apply map diffs (blocks destroyed)
    if (state.md) {
      for (const { c, r, t } of state.md) {
        const prev = this.map[r]?.[c];
        if (prev !== t) {
          this.map[r][c] = t;
          this._drawTile(c, r);
          if (this._spiralStarted && prev !== TILE.WALL && t === TILE.WALL) {
            audioManager.playMapCloseHit();
          }
        }
      }
    }

    // 3. Process one-time events (explosions, sounds)
    if (state.ev) {
      for (const ev of state.ev) {
        if (ev.t === 'explode') {
          // Use pre-computed tiles from host so block removal from md (step 1) doesn't
          // cause the explosion to incorrectly travel through where blocks were.
          const tiles = ev.tiles || calcExplosionTiles(this.map, ev.col, ev.row, ev.range, ev.pierce);
          for (const { col, row, type } of tiles) {
            this._spawnExplosionVisual(col, row, type);
          }
          audioManager.playExplosion(ev.range);
        } else if (ev.t === 'death') {
          audioManager.playPlayerDeath();
        } else if (ev.t === 'pickup') {
          audioManager.playItemPickup();
        } else if (ev.t === 'wm_launch') {
          this._createWillEMissile({
            id: ev.id,
            ownerIndex: Number(ev.pi) || 0,
            startX: Number(ev.sx) || 0,
            startY: Number(ev.sy) || 0,
            targetCol: Number(ev.tc) || 0,
            targetRow: Number(ev.tr) || 0,
            targetX: Number(ev.tx) || 0,
            targetY: Number(ev.ty) || 0,
            durationMs: Math.max(1, Number(ev.ms) || WILL_E_MISSILE_TRAVEL_MS),
            resolveImpact: false,
          });
        } else if (ev.t === 'end' && !this._gameOver) {
          this._endRound(ev.wi >= 0 ? this.players[ev.wi] : null);
        }
      }
    }

    // 4. Update players
    if (state.pl) {
      state.pl.forEach((ps, i) => {
        const p = this.players[i];
        if (!p) return;

        if (ps.fd) p._facing = ps.fd;
        p._walkFrame = ps.fr || 0;
        if (p.characterId === 'bomby') {
          p.setBombyTransformState(!!ps.bt);
        }
        if (p.characterId === 'dracarys') {
          p.setDracarysChargeState(!!ps.dc);
        }

        if (i !== this.myPlayerIndex) {
          // Other players: interpolate toward authoritative position
          if (ps.al) {
            p.setNetworkTarget(ps.x, ps.y, ps.vx || 0, ps.vy || 0, ps.sp || 160);
            // Snap immediately on respawn (avoid sliding from death tile)
            if (!p.alive) {
              p.sprite.setPosition(ps.x, ps.y);
              p.sprite.setAlpha(1);
              p.sprite.setDepth(10);
              p.setOverheadPosition(ps.x, ps.y);
              p.label.setAlpha(1);
              const invMs = p.characterId === 'bony'
                ? Math.max(0, Number(p.characterDef?.abilityInvincibleMs || 2000))
                : 1500;
              this._playResurrectionEffect(ps.x, ps.y, p.characterId === 'bony');
              p._activateTemporaryInvincibility?.(invMs);
            }
            if ((ps.vx || 0) !== 0 || (ps.vy || 0) !== 0) {
              p._setWalkTexture();
            } else {
              p._setIdleTexture();
            }
          } else {
            // Dead: snap directly, no interpolation needed
            p.sprite.setPosition(ps.x, ps.y);
            p.setOverheadPosition(ps.x, ps.y);
            if (p.alive && !ps.al) {
              p._setDeadTexture();
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
            p._setDeadTexture();
            p.sprite.setAlpha(0.6);
            p.sprite.setDepth(1);
            p.label.setAlpha(0.3);
          } else if (!p.alive && ps.al) {
            // Host confirmed respawn — snap to spawn point and apply respawn visuals
            p.sprite.setPosition(ps.x, ps.y);
            p._walkFrame = 0;
            p._setIdleTexture();
            p.sprite.setAlpha(1);
            p.sprite.setDepth(10);
            p.sprite.clearTint();
            p._restoreBaseTint();
            p.label.setAlpha(1);
            p.setOverheadPosition(ps.x, ps.y);
            const invMs = p.characterId === 'bony'
              ? Math.max(0, Number(p.characterDef?.abilityInvincibleMs || 2000))
              : 1500;
            this._playResurrectionEffect(ps.x, ps.y, p.characterId === 'bony');
            p._activateTemporaryInvincibility?.(invMs);
          }
          // No position reconciliation — client position is never overridden
        }

        const prevStunned    = p.stunned;
        const prevReverse    = p._reverseControls;
        const prevRushActive = p._rushActive;

        p.alive           = ps.al;
        p.lives           = ps.lv;
        p.stats.maxBombs  = ps.mb;
        p.stats.bombRange = ps.br;
        p.stats.speed     = ps.sp;
        p.stunned         = ps.st;
        p._reverseControls = ps.rv || false;
        p._rushActive     = ps.ra || false;
        p._rushPending    = ps.rp || false;
        p._abilityCooldownRemaining = Math.max(0, Number(ps.ac || 0));
        p.stats.kick      = ps.ki || false;
        p.stats.multiStar = ps.ms || false;

        // Reinit curse timers when host flips them on — without this the client
        // update() loop would see curseTimer=0 and immediately call _clearCurse().
        if (ps.st && !prevStunned)    p.curseTimer = 10000;
        if (ps.rv && !prevReverse)    p.curseTimer = 10000;
        if (ps.ra && !prevRushActive) p._rushTimer  = 5000;

        const hasCurseVisual = !!(ps.al && (ps.st || ps.rv || ps.ra));
        p.setCurseVisualActive(hasCurseVisual);
        if (!hasCurseVisual && ps.al) p._restoreBaseTint();
        p.refreshAbilityStatus();
      });
    }

    // 5. Reconcile bomb sprites (no timer logic — just visual presence)
    if (state.bm) {
      const bombTextureByKey = new Map(state.bm.map(b => [`${b.col},${b.row}`, b.tk || 'bomb']));
      const newSet = new Set([...bombTextureByKey.keys()]);

      // Own bombs whose position is no longer in host state have been moved or exploded.
      // Destroy them so their sprite is removed and normal reconcile can create a fresh
      // sprite at the host-authoritative position.
      for (const [key, bomb] of this.bombManager.bombs) {
        if (!newSet.has(key)) {
          bomb.destroy();
          this.bombManager.bombs.delete(key);
          // If this player owns it, fix the active-bomb counter
          const owner = this.players[this.myPlayerIndex];
          if (owner) owner.activeBombs = Math.max(0, owner.activeBombs - 1);
        }
      }

      for (const [key, entry] of this._clientBombSprites) {
        if (!newSet.has(key)) {
          if (entry.sprite.active) entry.sprite.destroy();
          this._clientBombSprites.delete(key);
        }
      }

      // Update remote bomb positions for client-side collision
      this.bombManager.remoteBombs.clear();
      for (const { col, row } of state.bm) {
        const key = `${col},${row}`;
        if (!this.bombManager.bombs.has(key)) this.bombManager.remoteBombs.add(key);
      }

      // If a remote bomb just appeared where the local player is standing,
      // add it to their passable set so they can exit the tile.
      const myPlayer = this.players[this.myPlayerIndex];
      if (myPlayer) {
        const R = Math.round(TILE_SIZE * 3 / 8);
        const playerTile = myPlayer.tilePos;
        for (const { col, row } of state.bm) {
          const key = `${col},${row}`;
          // Skip own bombs
          if (this.bombManager.bombs.has(key)) continue;
          // Check if player overlaps the bomb tile OR is standing in that tile
          const overlaps = myPlayer._overlapsCircle(myPlayer.x, myPlayer.y, R, col, row);
          const sameTile = playerTile.col === col && playerTile.row === row;
          // Also allow if player is very close to the bomb center (handles edge cases)
          const bombCenter = tileToPixel(col, row, TILE_SIZE);
          const distToBomb = Phaser.Math.Distance.Between(myPlayer.x, myPlayer.y, bombCenter.x, bombCenter.y);
          const closeToBomb = distToBomb < TILE_SIZE * 0.8;
          if (overlaps || sameTile || closeToBomb) {
            myPlayer._passableBombs.add(key);
          }
        }
      }

      for (const { col, row } of state.bm) {
        const key = `${col},${row}`;
        // Own bomb still at this exact position — its sprite is already rendered
        if (this.bombManager.bombs.has(key)) continue;
        const textureKey = bombTextureByKey.get(key) || 'bomb';
        const current = this._clientBombSprites.get(key);

        if (current && current.textureKey !== textureKey) {
          if (current.sprite.active) current.sprite.destroy();
          this._clientBombSprites.delete(key);
        }

        if (!this._clientBombSprites.has(key)) {
          const pos = tileToPixel(col, row, TILE_SIZE);
          const spr = this.add.sprite(pos.x, pos.y, textureKey).setDepth(5);
          this.tweens.add({
            targets: spr, scaleX: 1.15, scaleY: 1.15,
            duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
          });
          this._clientBombSprites.set(key, { sprite: spr, textureKey });
        }
      }
    }

    // 6. Reconcile items
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

    // 7. Game over from host
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
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    action1Just: false,
    action2Just: false,
    action3Just: false,
    action4Just: false,
    bombJust: false,
    actionJust: false,
  };
}
