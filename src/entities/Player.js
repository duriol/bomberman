import {
  TILE_SIZE, TILE, DEFAULT_PLAYER_STATS, PLAYER_COLORS,
  SPAWN_POSITIONS, RESPAWN_DELAY,
} from '../data/constants.js';
import { pixelToTile, tileToPixel, isWalkable } from '../utils/MapGenerator.js';
import { audioManager } from '../systems/AudioManager.js';

export class Player {
  /**
   * @param {Phaser.Scene} scene
   * @param {number}       index - 0-based player index
   * @param {object[][]}   map   - tile map reference
   * @param {object}       bombManager
   */
  constructor(scene, index, map, bombManager) {
    this.scene      = scene;
    this.index      = index;
    this.map        = map;
    this.bombManager = bombManager;

    const spawn = SPAWN_POSITIONS[index];
    const pos   = tileToPixel(spawn.col, spawn.row, TILE_SIZE);

    // Stats (cloned)
    this.stats = { ...DEFAULT_PLAYER_STATS };
    this.activeBombs  = 0;
    this.pendingRemote = [];  // bombs waiting for remote detonation
    this._passableBombs = new Set(); // bomb tiles this player can still walk through
    this.alive   = true;
    this.stunned = false;  // skull curse flag
    this.curseTimer = 0;
    this.lives   = this.stats.lives;
    this.onEvent = null;  // optional callback for online host event buffering

    // Create sprite
    this.sprite = scene.physics.add.sprite(pos.x, pos.y, `player_${index}_idle`);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDepth(10);
    this.sprite.setData('playerIndex', index);

    // Create player number text label
    this.label = scene.add.text(pos.x, pos.y - TILE_SIZE / 2 - 4,
      `P${index + 1}`, {
        fontSize: '11px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        fontFamily: 'monospace',
      }).setOrigin(0.5, 1).setDepth(20);

    // Animations
    this._createAnims();

    // Movement
    this._dx = 0;
    this._dy = 0;
    this._facing = 'down';
    this._walkTimer = 0;
    this._walkFrame = 0;
    this._lastMoveVx = 0;
    this._lastMoveVy = 0;

    // Network interpolation (used by remote clients)
    this._netBaseX    = null;
    this._netBaseY    = null;
    this._netVx       = 0;
    this._netVy       = 0;
    this._netSpeed    = 160;
    this._netTimestamp = 0;
  }

  _createAnims() {
    const key = `player_${this.index}`;
    if (!this.scene.anims.exists(`${key}_walk`)) {
      this.scene.anims.create({
        key: `${key}_walk`,
        frames: [
          { key: `player_${this.index}_walk`, frame: 0 },
          { key: `player_${this.index}_walk`, frame: 1 },
          { key: `player_${this.index}_walk`, frame: 2 },
          { key: `player_${this.index}_walk`, frame: 3 },
        ],
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  get tilePos() {
    return pixelToTile(this.sprite.x, this.sprite.y, TILE_SIZE);
  }

  /**
   * Called each frame by GameScene. input is the result of InputManager.getState(index).
   */
  update(delta, input) {
    if (!this.alive || !this.sprite.active) return;

    // Skull curse tick
    if (this.stunned) {
      this.curseTimer -= delta;
      if (this.curseTimer <= 0) this._clearCurse();
    }

    if (!input) return;

    // Remote detonation
    if (input.actionJust && this.stats.remote && this.pendingRemote.length > 0) {
      const bomb = this.pendingRemote.shift();
      if (bomb && !bomb.exploded) {
        bomb.detonate();
      }
    }

    // Place bomb
    if (input.bombJust) {
      this._tryPlaceBomb();
    }

    // Movement
    this._handleMovement(delta, input);

    // Update label position
    this.label.setPosition(this.sprite.x, this.sprite.y - TILE_SIZE / 2 - 4);
  }

  /**
   * Used by the host for client-authoritative remote players.
   * Runs curse ticking, bomb placement and remote detonation — but NOT movement.
   * Position is set directly from the client-reported coordinates before this call.
   */
  updateActionsOnly(delta, input) {
    if (!this.alive || !this.sprite.active) return;

    // Skull curse tick
    if (this.stunned) {
      this.curseTimer -= delta;
      if (this.curseTimer <= 0) this._clearCurse();
    }

    if (!input) return;

    // Remote detonation
    if (input.actionJust && this.stats.remote && this.pendingRemote.length > 0) {
      const bomb = this.pendingRemote.shift();
      if (bomb && !bomb.exploded) bomb.detonate();
    }

    // Place bomb
    if (input.bombJust) this._tryPlaceBomb();

    // Keep label synced to sprite (position was set externally)
    this.label.setPosition(this.sprite.x, this.sprite.y - TILE_SIZE / 2 - 4);
  }

  _handleMovement(delta, input) {
    const speed = this.stunned ? this.stats.speed * 2 : this.stats.speed;
    // Circular hitbox — radius = 3/8 of a tile (18 px for T=48)
    const R    = Math.round(TILE_SIZE * 3 / 8);
    const step = speed * (delta / 1000);
    let vx = 0, vy = 0;

    if (this.stunned) {
      // Random direction during stun
      if (this._stunFlipTimer === undefined) this._stunFlipTimer = 0;
      this._stunFlipTimer -= delta;
      if (this._stunFlipTimer <= 0) {
        this._stunDir = Phaser.Math.Between(0, 3);
        this._stunFlipTimer = Phaser.Math.Between(200, 500);
      }
      const dirs = [{ vx: 0, vy: -1 }, { vx: 0, vy: 1 }, { vx: -1, vy: 0 }, { vx: 1, vy: 0 }];
      const d = dirs[this._stunDir] || dirs[0];
      vx = d.vx;
      vy = d.vy;
    } else if (input.joy && typeof input.joy.vx === 'number' && typeof input.joy.vy === 'number') {
      // Analog joystick: already a unit vector, no diagonal penalty needed
      vx = input.joy.vx;
      vy = input.joy.vy;
    } else {
      if (input.up)    vy = -1;
      if (input.down)  vy =  1;
      if (input.left)  vx = -1;
      if (input.right) vx =  1;

      // Normalize diagonal (keyboard only — prevents speed boost on diagonals)
      if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
    }

    const newX = this.sprite.x + vx * step;
    const newY = this.sprite.y + vy * step;

    // Test each axis independently so the player slides along walls naturally
    const canX = this._canMoveCircle(newX, this.sprite.y, R);
    const canY = this._canMoveCircle(this.sprite.x, newY, R);

    let finalX = canX ? newX : this.sprite.x;
    let finalY = canY ? newY : this.sprite.y;

    // Corridor entry assist: when moving cardinally and one axis is blocked,
    // smoothly glide toward the nearest tile center on the free axis so the
    // player slips into corridors without needing pixel-perfect alignment.
    if (!canX && vx !== 0 && vy === 0) {
      finalY = this._snapToCenter(this.sprite.y, TILE_SIZE, step);
    }
    if (!canY && vy !== 0 && vx === 0) {
      finalX = this._snapToCenter(this.sprite.x, TILE_SIZE, step);
    }

    // Kick bombs: when movement is blocked and player has kick ability,
    // look for a bomb in the direction of travel and send it sliding.
    if (this.stats.kick) {
      if (!canX && vx !== 0) {
        const kdx = Math.sign(vx);
        const { col, row } = this.tilePos;
        const bomb = this.bombManager.bombs.get(`${col + kdx},${row}`)
                  || this.bombManager.bombs.get(`${col},${row}`);
        if (bomb && !bomb.exploded) bomb.kick(kdx, 0);
      }
      if (!canY && vy !== 0) {
        const kdy = Math.sign(vy);
        const { col, row } = this.tilePos;
        const bomb = this.bombManager.bombs.get(`${col},${row + kdy}`)
                  || this.bombManager.bombs.get(`${col},${row}`);
        if (bomb && !bomb.exploded) bomb.kick(0, kdy);
      }
    }

    const prevX = this.sprite.x;
    const prevY = this.sprite.y;

    this.sprite.x = finalX;
    this.sprite.y = finalY;

    // Track effective velocity for network dead-reckoning
    this._lastMoveVx = (finalX !== prevX) ? vx : 0;
    this._lastMoveVy = (finalY !== prevY) ? vy : 0;

    // Remove bombs from passable set once the circle no longer overlaps them
    for (const key of this._passableBombs) {
      const [bc, br] = key.split(',').map(Number);
      if (!this._overlapsCircle(this.sprite.x, this.sprite.y, R, bc, br)) {
        this._passableBombs.delete(key);
      }
    }

    const moving = (finalX !== prevX) || (finalY !== prevY);

    if (moving) {
      this._walkTimer += delta;
      if (this._walkTimer > 120) {
        this._walkTimer = 0;
        this._walkFrame = (this._walkFrame + 1) % 4;
      }
      this.sprite.setTexture(`player_${this.index}_walk_${this._walkFrame}`);
    } else {
      this._walkFrame = 0;
      this.sprite.setTexture(`player_${this.index}_idle`);
    }
  }

  /**
   * Circular hitbox vs tile-grid collision.
   * Tests a circle of radius r centered at (x, y) against all solid tiles
   * using the closest-point-on-AABB method.
   */
  _canMoveCircle(x, y, r) {
    const col0 = Math.floor((x - r) / TILE_SIZE);
    const col1 = Math.floor((x + r) / TILE_SIZE);
    const row0 = Math.floor((y - r) / TILE_SIZE);
    const row1 = Math.floor((y + r) / TILE_SIZE);
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        const solid = !isWalkable(this.map, col, row) ||
                      (this.bombManager.hasBombAt(col, row) && !this._passableBombs.has(`${col},${row}`));
        if (!solid) continue;
        const nearX = Phaser.Math.Clamp(x, col * TILE_SIZE, (col + 1) * TILE_SIZE);
        const nearY = Phaser.Math.Clamp(y, row * TILE_SIZE, (row + 1) * TILE_SIZE);
        const dx = x - nearX, dy = y - nearY;
        if (dx * dx + dy * dy < r * r) return false;
      }
    }
    return true;
  }

  /**
   * Moves coord toward the nearest tile center by at most maxStep.
   * Used for corridor-entry assist when cardinal movement is blocked.
   */
  _snapToCenter(coord, T, maxStep) {
    const tile   = Math.floor(coord / T);
    const c1     = tile * T + T / 2;
    const c2     = (tile + 1) * T + T / 2;
    const target = Math.abs(coord - c1) <= Math.abs(coord - c2) ? c1 : c2;
    const diff   = target - coord;
    if (diff === 0) return coord;
    return coord + Math.min(Math.abs(diff), maxStep) * Math.sign(diff);
  }

  /** Returns true if circle at (px,py) with radius r overlaps tile (col,row) */
  _overlapsCircle(px, py, r, col, row) {
    const nearX = Phaser.Math.Clamp(px, col * TILE_SIZE, (col + 1) * TILE_SIZE);
    const nearY = Phaser.Math.Clamp(py, row * TILE_SIZE, (row + 1) * TILE_SIZE);
    const dx = px - nearX, dy = py - nearY;
    return dx * dx + dy * dy < r * r;
  }

  _tryPlaceBomb() {
    if (this.activeBombs >= this.stats.maxBombs) return;
    const { col, row } = this.tilePos;
    if (this.bombManager.hasBombAt(col, row)) return;

    const bomb = this.bombManager.placeBomb(col, row, this);
    if (bomb) {
      this.activeBombs++;
      // Mark this tile as passable so the player can walk away from the bomb
      this._passableBombs.add(`${col},${row}`);
      audioManager.playPlaceBomb();
      if (this.stats.remote) {
        this.pendingRemote.push(bomb);
      }
    }
  }

  onBombExploded(col, row) {
    this.activeBombs = Math.max(0, this.activeBombs - 1);
    this._passableBombs.delete(`${col},${row}`);
    // Remove from pending remote if present
    this.pendingRemote = this.pendingRemote.filter(b => !b.exploded);
  }

  /** Apply an item to this player */
  applyItem(type) {
    audioManager.playItemPickup();
    switch (type) {
      case 'bomb_up':  this.stats.maxBombs  = Math.min(8, this.stats.maxBombs + 1); break;
      case 'fire_up':  this.stats.bombRange = Math.min(8, this.stats.bombRange + 1); break;
      case 'speed_up': this.stats.speed     = Math.min(280, this.stats.speed + 20);  break;
      case 'remote':   this.stats.remote    = true;  break;
      case 'pierce':   this.stats.pierce    = true;  break;
      case 'kick':     this.stats.kick      = true;  break;
      case 'skull':    this._applyCurse();           break;
    }
    if (this.onEvent) this.onEvent({ t: 'pickup', pi: this.index, it: type });
  }

  _applyCurse() {
    audioManager.playSkull();
    this.stunned = true;
    this.curseTimer = 10000;  // 10 seconds
    this._stunFlipTimer = 0;
    this._stunDir = 0;
    // Visual feedback — flash sprite red
    this.sprite.setTint(0xff0000);
  }

  _clearCurse() {
    this.stunned = false;
    this.sprite.clearTint();
  }

  /** Called when this player gets hit by an explosion */
  die() {
    if (!this.alive) return;
    audioManager.playPlayerDeath();
    this.alive = false;
    this.sprite.setTexture(`player_${this.index}_dead`);
    this.sprite.setAlpha(0.6);
    this.sprite.setDepth(1);
    this.label.setAlpha(0.3);
    this.lives--;
    if (this.onEvent) this.onEvent({ t: 'death', pi: this.index });
  }

  /** Respawn at original position */
  respawn() {
    if (this.lives <= 0) return;
    const spawn = SPAWN_POSITIONS[this.index];
    const pos = tileToPixel(spawn.col, spawn.row, TILE_SIZE);
    this.sprite.setPosition(pos.x, pos.y);
    this.sprite.setTexture(`player_${this.index}_idle`);
    this.sprite.setAlpha(1);
    this.sprite.setDepth(10);
    this.sprite.clearTint();
    this.label.setAlpha(1);
    this.alive  = true;
    this.stunned = false;
    this.activeBombs = 0;
    this.pendingRemote = [];
    if (this.onEvent) this.onEvent({ t: 'respawn', pi: this.index, x: pos.x, y: pos.y });
    // Brief invincibility flash — onComplete guarantees alpha=1 (yoyo ends at 'from')
    this.scene.tweens.add({
      targets: this.sprite,
      alpha:   { from: 0.3, to: 1 },
      duration: 200,
      repeat:   6,
      yoyo:     true,
      onComplete: () => { if (this.sprite.active) this.sprite.setAlpha(1); },
    });
  }

  // ── Network interpolation (remote clients only) ──────────────────────────

  /**
   * Called by the client when a new authoritative snapshot arrives.
   * Stores the base position + velocity for dead-reckoning extrapolation.
   * @param {number} x     Authoritative pixel x
   * @param {number} y     Authoritative pixel y
   * @param {number} vx    Normalized velocity x (−1 / 0 / 1, can be fractional for diagonals)
   * @param {number} vy    Normalized velocity y
   * @param {number} speed Authoritative speed in px/s
   */
  setNetworkTarget(x, y, vx, vy, speed) {
    this._netBaseX     = x;
    this._netBaseY     = y;
    this._netVx        = vx;
    this._netVy        = vy;
    this._netSpeed     = speed;
    this._netTimestamp = performance.now();
  }

  /**
   * Called every frame by the client for remote players.
   * Extrapolates the expected position from the last snapshot using dead-reckoning,
   * then smoothly lerps the sprite toward it to eliminate pop/teleportation.
   */
  interpolateToNetwork(delta) {
    if (this._netBaseX === null) return;

    // Extrapolate forward from last snapshot (cap at 200 ms to avoid over-shooting)
    const elapsed = Math.min((performance.now() - this._netTimestamp) / 1000, 0.2);
    const targetX = this._netBaseX + this._netVx * this._netSpeed * elapsed;
    const targetY = this._netBaseY + this._netVy * this._netSpeed * elapsed;

    // Exponential lerp — framerate-independent, settles within ~150 ms
    const alpha = 1 - Math.exp(-20 * delta / 1000);
    this.sprite.x = Phaser.Math.Linear(this.sprite.x, targetX, alpha);
    this.sprite.y = Phaser.Math.Linear(this.sprite.y, targetY, alpha);

    this.label.setPosition(this.sprite.x, this.sprite.y - TILE_SIZE / 2 - 4);
  }

  destroy() {
    this.sprite.destroy();
    this.label.destroy();
  }
}
