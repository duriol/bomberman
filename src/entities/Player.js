import {
  TILE_SIZE,
  TILE,
  DEFAULT_PLAYER_STATS,
  PLAYER_COLORS,
  SPAWN_POSITIONS,
  DEFAULT_CHARACTER_ID,
} from '../data/constants.js';
import { pixelToTile, tileToPixel } from '../utils/MapGenerator.js';
import { audioManager } from '../systems/AudioManager.js';
import {
  getCharacterDef,
  getCharacterIdleKey,
  getCharacterScale,
  getCharacterWalkFrameCount,
  getCharacterWalkKey,
  normalizeCharacterId,
} from '../utils/CharacterAssets.js';

function mixColorWithWhite(color, amount = 0.55) {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const mix = (channel) => Math.round(channel + (255 - channel) * amount);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

function normalizeProfile(index, profileOrName) {
  if (typeof profileOrName === 'string') {
    return {
      name: profileOrName,
      characterId: DEFAULT_CHARACTER_ID,
    };
  }

  const p = (profileOrName && typeof profileOrName === 'object') ? profileOrName : {};
  return {
    name: p.name || `P${index + 1}`,
    characterId: normalizeCharacterId(p.characterId),
  };
}

export class Player {
  /**
   * @param {Phaser.Scene} scene
   * @param {number}       index - 0-based player index
   * @param {object[][]}   map   - tile map reference
   * @param {object}       bombManager
   * @param {object|string} profileOrName
   */
  constructor(scene, index, map, bombManager, profileOrName = {}) {
    this.scene = scene;
    this.index = index;
    this.map = map;
    this.bombManager = bombManager;

    const profile = normalizeProfile(index, profileOrName);
    const safeDisplayName = String(profile.name || `P${index + 1}`).trim().slice(0, 12);
    this.displayName = safeDisplayName || `P${index + 1}`;
    this.characterId = normalizeCharacterId(profile.characterId);
    this.characterDef = getCharacterDef(this.characterId);

    const spawn = SPAWN_POSITIONS[index];
    const pos = tileToPixel(spawn.col, spawn.row, TILE_SIZE);

    // Stats (cloned)
    this.stats = { ...DEFAULT_PLAYER_STATS };
    this.activeBombs = 0;
    this._passableBombs = new Set(); // bomb tiles this player can still walk through
    this.alive = true;
    this.stunned = false; // skull curse flag
    this.curseTimer = 0;
    this._isRushing = false; // rush curse: actively charging at 3x speed
    this._rushActive = false; // rush curse: true for full 5s duration
    this._rushTimer = 0; // rush countdown ms
    this._rushPending = false;
    this._rushVx = 0;
    this._rushVy = 0;
    this._curseClearCallback = null; // called by _clearCurse (bounty item respawn)
    this.lives = this.stats.lives;
    this.respawnInvincible = false; // true during post-respawn grace period
    this.onEvent = null; // optional callback for online host event buffering

    this._duplicateTint = null;
    this._hasCurseTint = false;

    this._bombyTransformed = false;
    this._bombyAbilityBombKey = null;
    this._bombyImmuneBomb = false;

    const fallbackIdle = getCharacterIdleKey(DEFAULT_CHARACTER_ID, 'down');
    const initialIdle = getCharacterIdleKey(this.characterId, 'down');
    const initialTexture = scene.textures.exists(initialIdle) ? initialIdle : fallbackIdle;
    if (!scene.textures.exists(initialIdle)) {
      this.characterId = DEFAULT_CHARACTER_ID;
      this.characterDef = getCharacterDef(this.characterId);
    }

    // Create sprite
    this.sprite = scene.physics.add.sprite(pos.x, pos.y, initialTexture);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDepth(10);
    this.sprite.setData('playerIndex', index);
    this._applyCharacterVisualDefaults();

    // Create player name text label
    this.label = scene.add.text(pos.x, pos.y - TILE_SIZE / 2 - 4,
      this.displayName, {
        fontSize: '10px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        fontFamily: 'monospace',
      }).setOrigin(0.5, 1).setDepth(20);

    // Movement
    this._dx = 0;
    this._dy = 0;
    this._facing = 'down';
    this._walkTimer = 0;
    this._walkFrame = 0;
    this._lastMoveVx = 0;
    this._lastMoveVy = 0;

    // Network interpolation (used by remote clients)
    this._netBaseX = null;
    this._netBaseY = null;
    this._netVx = 0;
    this._netVy = 0;
    this._netSpeed = 160;
    this._netTimestamp = 0;
  }

  _applyCharacterVisualDefaults() {
    const scale = getCharacterScale(this.scene, this.characterId, 'down');
    this.sprite.setScale(scale);
    this.sprite.setOrigin(0.5, this.characterDef.originY || 0.82);
    this._restoreBaseTint();
  }

  setDuplicateFilter(enabled, sourceColor = null) {
    if (!enabled) {
      this._duplicateTint = null;
      this._restoreBaseTint();
      return;
    }
    const c = sourceColor ?? (PLAYER_COLORS[this.index % PLAYER_COLORS.length]?.main ?? 0xffffff);
    this._duplicateTint = mixColorWithWhite(c, 0.5);
    this._restoreBaseTint();
  }

  _getWalkFrameCount() {
    return getCharacterWalkFrameCount(this.characterId, this._facing);
  }

  _setIdleTexture() {
    const key = getCharacterIdleKey(this.characterId, this._facing);
    this.sprite.setFlipX(this._facing === 'left');
    this.sprite.setTexture(key);
  }

  _setWalkTexture() {
    const key = getCharacterWalkKey(this.characterId, this._facing, this._walkFrame);
    this.sprite.setFlipX(this._facing === 'left');
    this.sprite.setTexture(key);
  }

  _restoreBaseTint() {
    if (this._hasCurseTint) return;
    if (this._duplicateTint !== null) {
      this.sprite.setTint(this._duplicateTint);
      return;
    }
    this.sprite.clearTint();
  }

  _setDeadTexture() {
    this.sprite.setFlipX(false);
    this.sprite.setTexture(getCharacterIdleKey(this.characterId, 'down'));
    this._restoreBaseTint();
  }

  _setBombyTransformedVisual(active) {
    const next = !!active;
    this._bombyTransformed = next;
    const visible = !next;
    this.sprite.setVisible(visible);
    this.label.setVisible(visible);
    if (!next) {
      this._walkFrame = 0;
      this._setIdleTexture();
      this._restoreBaseTint();
    }
  }

  isImmuneToExplosion(owner) {
    return owner === this && this._bombyImmuneBomb;
  }

  _tryActivateCharacterAbility() {
    if (this.characterId !== 'bomby') return;
    if (this._bombyTransformed) return;
    if (!this.alive || !this.sprite.active) return;

    const { col, row } = this.tilePos;
    if (this.bombManager.hasBombAt(col, row)) return;

    const bomb = this.bombManager.placeBomb(col, row, this, {
      textureKey: this.characterDef.bombTexture || 'bomb_bomby',
      meta: { byAbility: true, characterId: this.characterId },
    });

    if (!bomb) return;

    this.activeBombs++;
    this._passableBombs.add(`${col},${row}`);
    this._bombyAbilityBombKey = `${col},${row}`;
    this._bombyImmuneBomb = true;
    this._setBombyTransformedVisual(true);
    audioManager.playPlaceBomb();
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  get tilePos() {
    return pixelToTile(this.sprite.x, this.sprite.y, TILE_SIZE);
  }

  _normalizeActionInput(input) {
    if (!input) {
      return {
        action1Just: false,
        action2Just: false,
        action3Just: false,
        action4Just: false,
      };
    }

    return {
      action1Just: !!(input.action1Just || input.a1Just || input.abilityJust),
      action2Just: !!(input.action2Just || input.a2Just || input.bombJust),
      action3Just: !!(input.action3Just || input.a3Just || input.actionJust),
      action4Just: !!(input.action4Just || input.a4Just),
    };
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

    // Rush curse tick
    if (this._rushActive) {
      this._rushTimer -= delta;
      if (this._rushTimer <= 0) this._clearCurse();
    }

    if (!input) return;

    const actionInput = this._normalizeActionInput(input);

    if (actionInput.action1Just) this._tryActivateCharacterAbility();

    // Action 3 = item action (multi-bomb for now)
    if (actionInput.action3Just && this.stats.multiStar) {
      this._tryPlaceMultiBomb();
    }

    // Action 2 = place bomb
    if (actionInput.action2Just) {
      this._tryPlaceBomb();
    }

    if (!this._bombyTransformed) {
      this._handleMovement(delta, input);
      this.label.setPosition(this.sprite.x, this.sprite.y - TILE_SIZE / 2 - 4);
    }
  }

  /**
   * Used by the host for client-authoritative remote players.
   * Runs curse ticking, bomb placement and remote detonation � but NOT movement.
   * Position is set directly from the client-reported coordinates before this call.
   */
  updateActionsOnly(delta, input) {
    if (!this.alive || !this.sprite.active) return;

    // Skull curse tick
    if (this.stunned) {
      this.curseTimer -= delta;
      if (this.curseTimer <= 0) this._clearCurse();
    }

    // Rush curse tick
    if (this._rushActive) {
      this._rushTimer -= delta;
      if (this._rushTimer <= 0) this._clearCurse();
    }

    if (!input) return;

    const actionInput = this._normalizeActionInput(input);

    if (actionInput.action1Just) this._tryActivateCharacterAbility();
    if (actionInput.action3Just && this.stats.multiStar) this._tryPlaceMultiBomb();
    if (actionInput.action2Just) this._tryPlaceBomb();

    // Kick: client sends direction + exact tile, host executes on authoritative bomb map
    if (this.stats.kick && (input.kx || input.ky)) {
      const col = (input.kc !== undefined) ? input.kc : this.tilePos.col;
      const row = (input.kr !== undefined) ? input.kr : this.tilePos.row;
      const bomb = input.kx
        ? this.bombManager.bombs.get(`${col + input.kx},${row}`) || this.bombManager.bombs.get(`${col},${row}`)
        : this.bombManager.bombs.get(`${col},${row + input.ky}`) || this.bombManager.bombs.get(`${col},${row}`);
      if (bomb && !bomb.exploded) bomb.kick(input.kx || 0, input.ky || 0);
    }

    // Keep label synced to sprite (position was set externally)
    if (!this._bombyTransformed) {
      this.label.setPosition(this.sprite.x, this.sprite.y - TILE_SIZE / 2 - 4);
    }
  }

  _handleMovement(delta, input) {
    if (this._bombyTransformed) return;

    const speed = this.stunned ? this.stats.speed * 2 : this.stats.speed;
    const R = Math.round(TILE_SIZE * 3 / 8); // 18 px
    const step = speed * (delta / 1000);
    let vx = 0;
    let vy = 0;

    if (this._isRushing) {
      // Rush curse: locked direction at 3� speed until hitting a wall
      const rushStep = this.stats.speed * 3 * (delta / 1000);
      vx = this._rushVx;
      vy = this._rushVy;
      if (vx > 0) this._facing = 'right';
      else if (vx < 0) this._facing = 'left';
      else if (vy < 0) this._facing = 'up';
      else if (vy > 0) this._facing = 'down';
      const nx = this.sprite.x + vx * rushStep;
      const ny = this.sprite.y + vy * rushStep;
      const canX = this._canMoveCircle(nx, this.sprite.y, R);
      const canY = this._canMoveCircle(this.sprite.x, ny, R);
      if ((vx !== 0 && !canX) || (vy !== 0 && !canY)) {
        // Hit a wall � stop this dash; if rush still active, re-arm for next input
        this._isRushing = false;
        if (this._rushActive) this._rushPending = true;
      } else {
        this.sprite.x = canX ? nx : this.sprite.x;
        this.sprite.y = canY ? ny : this.sprite.y;
        this._lastMoveVx = vx;
        this._lastMoveVy = vy;
        this.label.setPosition(this.sprite.x, this.sprite.y - TILE_SIZE / 2 - 4);
        // Walk animation
        this._walkTimer += delta;
        const frameCount = this._getWalkFrameCount();
        if (this._walkTimer > 80) {
          this._walkTimer = 0;
          this._walkFrame = (this._walkFrame + 1) % frameCount;
        }
        this._walkFrame %= frameCount;
        this._setWalkTexture();
      }
      return;
    }

    if (this.stunned) {
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
    } else if (input.joy && typeof input.joy.vx === 'number') {
      vx = input.joy.vx;
      vy = input.joy.vy;
    } else {
      if (input.up) vy = -1;
      if (input.down) vy = 1;
      if (input.left) vx = -1;
      if (input.right) vx = 1;
      if (vx !== 0 && vy !== 0) {
        vx *= 0.707;
        vy *= 0.707;
      }
    }

    // Track the last non-zero cardinal direction for multi-bomb and rush
    if (!this.stunned) {
      if (vx > 0.5) this._facing = 'right';
      else if (vx < -0.5) this._facing = 'left';
      else if (vy < -0.5) this._facing = 'up';
      else if (vy > 0.5) this._facing = 'down';

      // Rush curse trigger: lock direction on first input press after picking up rush
      if ((vx !== 0 || vy !== 0) && this._rushPending) {
        const ax = Math.abs(vx);
        const ay = Math.abs(vy);
        this._rushVx = ax >= ay ? Math.sign(vx) : 0;
        this._rushVy = ax < ay ? Math.sign(vy) : 0;
        this._isRushing = true;
        this._rushPending = false;
      }
    }

    const prevX = this.sprite.x;
    const prevY = this.sprite.y;
    let finalX = prevX;
    let finalY = prevY;

    if (vx !== 0 || vy !== 0) {
      const ax = Math.abs(vx);
      const ay = Math.abs(vy);
      // Cardinal detection: one axis is dominant (the other is < 50% of it).
      // Works for both keyboard (axis is 0/1) and analog joystick.
      const cardinalX = ax > 0 && ay < ax * 0.5;
      const cardinalY = ay > 0 && ax < ay * 0.5;
      const alignStep = step * 5;

      if (cardinalX) {
        // Horizontal move � snap Y first so collision is tested at the aligned position.
        // This is what prevents sticking on wall corners.
        const sy = this._snapToCenter(prevY, TILE_SIZE, alignStep);
        const nx = prevX + vx * step;
        if (this._canMoveCircle(nx, sy, R)) {
          finalX = nx;
          finalY = sy;
        } else {
          // Blocked forward; still apply Y snap if the spot is clear
          if (this._canMoveCircle(prevX, sy, R)) finalY = sy;
        }
      } else if (cardinalY) {
        // Vertical move � snap X first
        const sx = this._snapToCenter(prevX, TILE_SIZE, alignStep);
        const ny = prevY + vy * step;
        if (this._canMoveCircle(sx, ny, R)) {
          finalY = ny;
          finalX = sx;
        } else {
          if (this._canMoveCircle(sx, prevY, R)) finalX = sx;
        }
      } else {
        // True diagonal � resolve each axis independently, no snap
        const nx = prevX + vx * step;
        const ny = prevY + vy * step;
        if (this._canMoveCircle(nx, prevY, R)) finalX = nx;
        if (this._canMoveCircle(prevX, ny, R)) finalY = ny;
      }
    }

    // Kick bombs on blocked axis
    if (this.stats.kick) {
      if (finalX === prevX && vx !== 0) {
        const kdx = Math.sign(vx);
        const { col, row } = this.tilePos;
        const kCol = col + kdx;
        // Search in the 2 tiles ahead (handles position rounding edge cases)
        const bomb = this.bombManager.bombs.get(`${kCol},${row}`)
          || this.bombManager.bombs.get(`${kCol + kdx},${row}`)
          || this.bombManager.bombs.get(`${col},${row}`);
        if (bomb && !bomb.exploded) {
          if (this.scene.isOnlineClient) {
            this._pendingKick = { dx: kdx, dy: 0, col: bomb.col - kdx, row: bomb.row };
          } else {
            bomb.kick(kdx, 0);
          }
        } else if (this.scene.isOnlineClient) {
          // Remote bomb: check 2 tiles ahead
          const remKey1 = `${kCol},${row}`;
          const remKey2 = `${kCol + kdx},${row}`;
          const remKey = this.bombManager.remoteBombs.has(remKey1) ? remKey1
            : this.bombManager.remoteBombs.has(remKey2) ? remKey2
              : null;
          if (remKey) {
            const [rc] = remKey.split(',').map(Number);
            this._pendingKick = { dx: kdx, dy: 0, col: rc - kdx, row };
          }
        }
      }
      if (finalY === prevY && vy !== 0) {
        const kdy = Math.sign(vy);
        const { col, row } = this.tilePos;
        const kRow = row + kdy;
        const bomb = this.bombManager.bombs.get(`${col},${kRow}`)
          || this.bombManager.bombs.get(`${col},${kRow + kdy}`)
          || this.bombManager.bombs.get(`${col},${row}`);
        if (bomb && !bomb.exploded) {
          if (this.scene.isOnlineClient) {
            this._pendingKick = { dx: 0, dy: kdy, col: bomb.col, row: bomb.row - kdy };
          } else {
            bomb.kick(0, kdy);
          }
        } else if (this.scene.isOnlineClient) {
          // Remote bomb: check 2 tiles ahead
          const remKey1 = `${col},${kRow}`;
          const remKey2 = `${col},${kRow + kdy}`;
          const remKey = this.bombManager.remoteBombs.has(remKey1) ? remKey1
            : this.bombManager.remoteBombs.has(remKey2) ? remKey2
              : null;
          if (remKey) {
            const [, rr] = remKey.split(',').map(Number);
            this._pendingKick = { dx: 0, dy: kdy, col, row: rr - kdy };
          }
        }
      }
    }

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
      const frameCount = this._getWalkFrameCount();
      if (this._walkTimer > 120) {
        this._walkTimer = 0;
        this._walkFrame = (this._walkFrame + 1) % frameCount;
      }
      this._walkFrame %= frameCount;
      this._setWalkTexture();
    } else {
      this._walkFrame = 0;
      this._setIdleTexture();
    }
  }

  _canPassBombs() {
    return this.characterId === 'wolf';
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
    // Inset for wall tiles � creates rounded-corner feel so players glide around wall corners
    const WALL_PAD = 4;
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        const tileType = this.map[row]?.[col];
        const bombBlocked = !this._canPassBombs()
          && this.bombManager.hasBombAt(col, row)
          && !this._passableBombs.has(`${col},${row}`);
        const solid = (tileType === TILE.WALL || tileType === TILE.BLOCK) || bombBlocked;
        if (!solid) continue;
        // Wall tiles use inset AABB so corners are passable (rounded feel)
        // Destructible blocks and bombs keep full AABB for exact collisions
        const pad = tileType === TILE.WALL ? WALL_PAD : 0;
        const nearX = Phaser.Math.Clamp(x, col * TILE_SIZE + pad, (col + 1) * TILE_SIZE - pad);
        const nearY = Phaser.Math.Clamp(y, row * TILE_SIZE + pad, (row + 1) * TILE_SIZE - pad);
        const dx = x - nearX;
        const dy = y - nearY;
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
    const tile = Math.floor(coord / T);
    const c1 = tile * T + T / 2;
    const c2 = (tile + 1) * T + T / 2;
    const target = Math.abs(coord - c1) <= Math.abs(coord - c2) ? c1 : c2;
    const diff = target - coord;
    if (diff === 0) return coord;
    return coord + Math.min(Math.abs(diff), maxStep) * Math.sign(diff);
  }

  /** Returns true if circle at (px,py) with radius r overlaps tile (col,row) */
  _overlapsCircle(px, py, r, col, row) {
    const nearX = Phaser.Math.Clamp(px, col * TILE_SIZE, (col + 1) * TILE_SIZE);
    const nearY = Phaser.Math.Clamp(py, row * TILE_SIZE, (row + 1) * TILE_SIZE);
    const dx = px - nearX;
    const dy = py - nearY;
    return dx * dx + dy * dy < r * r;
  }

  _tryPlaceBomb() {
    if (this.activeBombs >= this.stats.maxBombs) return;
    const { col, row } = this.tilePos;
    if (this.bombManager.hasBombAt(col, row)) return;

    const bomb = this.bombManager.placeBomb(col, row, this);
    if (bomb) {
      this.activeBombs++;
      this._passableBombs.add(`${col},${row}`);
      // Allow any player standing on this tile to exit (handles remote players placing bombs under others)
      const R = Math.round(TILE_SIZE * 3 / 8);
      for (const player of this.scene.players || []) {
        if (player === this) continue;
        if (player._overlapsCircle(player.x, player.y, R, col, row)) {
          player._passableBombs.add(`${col},${row}`);
        }
      }
      audioManager.playPlaceBomb();
    }
  }

  /** Place all remaining bombs in a line starting from tile ahead in facing direction */
  _tryPlaceMultiBomb() {
    const facingDelta = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] };
    const [dc, dr] = facingDelta[this._facing] || [0, 1];
    const R = Math.round(TILE_SIZE * 3 / 8);
    const { col: startCol, row: startRow } = this.tilePos;
    const limit = this.stats.maxBombs - this.activeBombs; // capture before loop: activeBombs++ would otherwise shrink this each iteration
    let placed = 0;
    let c = startCol + dc;
    let r = startRow + dr;
    while (placed < limit && c >= 0 && c < 15 && r >= 0 && r < 13) {
      const tile = this.map[r]?.[c];
      if (tile !== 0 && tile !== 3) break; // blocked by wall or block
      if (!this.bombManager.hasBombAt(c, r)) {
        const bomb = this.bombManager.placeBomb(c, r, this);
        if (bomb) {
          this.activeBombs++;
          // If the new bomb overlaps the current hitbox, allow exiting its tile.
          if (this._overlapsCircle(this.sprite.x, this.sprite.y, R, c, r)) {
            this._passableBombs.add(`${c},${r}`);
          }
          audioManager.playPlaceBomb();
          placed++;
        }
      }
      c += dc;
      r += dr;
    }
  }

  onBombExploded(col, row) {
    this.activeBombs = Math.max(0, this.activeBombs - 1);
    const key = `${col},${row}`;
    this._passableBombs.delete(key);

    if (this._bombyAbilityBombKey === key) {
      this._bombyAbilityBombKey = null;
      this._bombyImmuneBomb = false;
      this._setBombyTransformedVisual(false);
    }
  }

  /** Apply an item to this player */
  applyItem(type) {
    audioManager.playItemPickup();
    switch (type) {
      case 'bomb_up': this.stats.maxBombs = Math.min(6, this.stats.maxBombs + 1); break;
      case 'fire_up': this.stats.bombRange = Math.min(8, this.stats.bombRange + 1); break;
      case 'speed_up': this.stats.speed = Math.min(280, this.stats.speed + 20); break;
      case 'multi_bomb': this.stats.multiStar = true; break;
      case 'kick': this.stats.kick = true; break;
      case 'skull': this._applyCurse(); break;
      case 'rush': this._applyRush(); break;
      default: break;
    }
    if (this.onEvent) this.onEvent({ t: 'pickup', pi: this.index, it: type });
  }

  _applyCurse() {
    audioManager.playSkull();
    this.stunned = true;
    this.curseTimer = 10000; // 10 seconds
    this._stunFlipTimer = 0;
    this._stunDir = 0;
    this._hasCurseTint = true;
    this.sprite.setTint(0xff0000);
  }

  _applyRush() {
    audioManager.playSkull();
    this._rushActive = true;
    this._rushPending = true;
    this._rushTimer = 5000; // 5 seconds, ticked down in update()
    this._hasCurseTint = true;
    this.sprite.setTint(0xff6600);
  }

  _clearCurse() {
    this.stunned = false;
    this._isRushing = false;
    this._rushActive = false;
    this._rushPending = false;
    this._rushTimer = 0;
    this._hasCurseTint = false;
    this._restoreBaseTint();
    if (this._curseClearCallback) {
      const cb = this._curseClearCallback;
      this._curseClearCallback = null;
      cb();
    }
  }

  /** Called when this player gets hit by an explosion */
  die() {
    if (!this.alive) return;
    if (this.respawnInvincible) return; // grace period after respawn
    // Trigger bounty item respawn callback if curse was active
    if (this.stunned || this._isRushing || this._rushPending) this._clearCurse();
    audioManager.playPlayerDeath();
    this.alive = false;
    this._setBombyTransformedVisual(false);
    this._setDeadTexture();
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
    this._walkFrame = 0;
    this._setBombyTransformedVisual(false);
    this._setIdleTexture();
    this.sprite.setAlpha(1);
    this.sprite.setDepth(10);
    this.label.setAlpha(1);
    this.alive = true;
    this._clearCurse(); // clears stunned/_isRushing/_rushPending and fires any pending callback
    this.activeBombs = 0;
    this.respawnInvincible = true;
    this.scene.time.delayedCall(1500, () => { this.respawnInvincible = false; });
    if (this.onEvent) this.onEvent({ t: 'respawn', pi: this.index, x: pos.x, y: pos.y });
    // Brief invincibility flash � onComplete guarantees alpha=1 (yoyo ends at 'from')
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: { from: 0.3, to: 1 },
      duration: 200,
      repeat: 6,
      yoyo: true,
      onComplete: () => { if (this.sprite.active) this.sprite.setAlpha(1); },
    });
  }

  setBombyTransformState(active) {
    if (this.characterId !== 'bomby') return;
    this._setBombyTransformedVisual(!!active);
    if (!active) {
      this._bombyAbilityBombKey = null;
      this._bombyImmuneBomb = false;
    }
  }

  // -- Network interpolation (remote clients only) --------------------------

  /**
   * Called by the client when a new authoritative snapshot arrives.
   * Stores the base position + velocity for dead-reckoning extrapolation.
   * @param {number} x     Authoritative pixel x
   * @param {number} y     Authoritative pixel y
   * @param {number} vx    Normalized velocity x (-1 / 0 / 1, can be fractional for diagonals)
   * @param {number} vy    Normalized velocity y
   * @param {number} speed Authoritative speed in px/s
   */
  setNetworkTarget(x, y, vx, vy, speed) {
    this._netBaseX = x;
    this._netBaseY = y;
    this._netVx = vx;
    this._netVy = vy;
    this._netSpeed = speed;
    this._netTimestamp = performance.now();
  }

  /**
   * Called every frame by the client for remote players.
   * Extrapolates the expected position from the last snapshot using dead-reckoning,
   * then smoothly lerps the sprite toward it to eliminate pop/teleportation.
   */
  interpolateToNetwork(delta) {
    if (this._netBaseX === null || this._bombyTransformed) return;

    // Extrapolate forward from last snapshot (cap at 200 ms to avoid over-shooting)
    const elapsed = Math.min((performance.now() - this._netTimestamp) / 1000, 0.2);
    const targetX = this._netBaseX + this._netVx * this._netSpeed * elapsed;
    const targetY = this._netBaseY + this._netVy * this._netSpeed * elapsed;

    // Exponential lerp � framerate-independent, settles within ~100 ms
    const alpha = 1 - Math.exp(-30 * delta / 1000);
    this.sprite.x = Phaser.Math.Linear(this.sprite.x, targetX, alpha);
    this.sprite.y = Phaser.Math.Linear(this.sprite.y, targetY, alpha);

    this.label.setPosition(this.sprite.x, this.sprite.y - TILE_SIZE / 2 - 4);
  }

  destroy() {
    this.sprite.destroy();
    this.label.destroy();
  }
}
