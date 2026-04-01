import { TILE_SIZE, TILE, BOMB_TIMER, EXPLOSION_DURATION, MAP_COLS, MAP_ROWS } from '../data/constants.js';
import { tileToPixel } from '../utils/MapGenerator.js';
import { audioManager } from './AudioManager.js';

// Standalone helper — used by both host and remote clients
export function calcExplosionTiles(map, originCol, originRow, range, pierce) {
  const tiles = [{ col: originCol, row: originRow, type: 'center' }];
  const directions = [
    { dc:  0, dr: -1, endType: 'end_up',    midType: 'middle_v' },
    { dc:  0, dr:  1, endType: 'end_down',  midType: 'middle_v' },
    { dc: -1, dr:  0, endType: 'end_left',  midType: 'middle_h' },
    { dc:  1, dr:  0, endType: 'end_right', midType: 'middle_h' },
  ];
  for (const dir of directions) {
    for (let i = 1; i <= range; i++) {
      const c = originCol + dir.dc * i;
      const r = originRow + dir.dr * i;
      if (c < 0 || c >= MAP_COLS || r < 0 || r >= MAP_ROWS) break;
      const tile = map[r][c];
      if (tile === TILE.WALL) break;
      if (tile === TILE.BLOCK) {
        tiles.push({ col: c, row: r, type: i === range ? dir.endType : dir.midType });
        if (!pierce) break;
        continue;
      }
      tiles.push({ col: c, row: r, type: i === range ? dir.endType : dir.midType });
    }
  }
  return tiles;
}

class Bomb {
  constructor(scene, col, row, owner, manager) {
    this.scene    = scene;
    this.col      = col;
    this.row      = row;
    this.owner    = owner;
    this.manager  = manager;
    this.exploded = false;
    this.range    = owner.stats.bombRange;
    this.pierce   = owner.stats.pierce;

    const pos = tileToPixel(col, row, TILE_SIZE);
    this.sprite = scene.add.sprite(pos.x, pos.y, 'bomb').setDepth(5);

    scene.tweens.add({
      targets: this.sprite, scaleX: 1.15, scaleY: 1.15,
      duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    this._timerEvent = scene.time.addEvent({
      delay: BOMB_TIMER, callback: this.detonate, callbackScope: this,
    });

    this._warnEvent = scene.time.addEvent({
      delay: BOMB_TIMER - 700,
      callback: () => {
        if (!this.exploded && this.sprite.active) {
          scene.tweens.add({
            targets: this.sprite, tint: 0xff4400, duration: 100, yoyo: true, repeat: 5,
          });
        }
      },
    });
  }

  getRemaining() { return this._timerEvent ? this._timerEvent.getRemaining() : 0; }

  detonate() {
    if (this.exploded) return;
    this.exploded = true;
    this._timerEvent.remove(false);
    this._warnEvent.remove(false);
    this.sprite.destroy();
    const { col, row } = this;
    this.manager.createExplosion(col, row, this.range, this.pierce, this.owner);
    this.owner.onBombExploded(col, row);
    this.manager.bombs.delete(`${col},${row}`);
  }

  kick(dx, dy) {
    const newCol = this.col + dx;
    const newRow = this.row + dy;
    if (!this.manager._isKickable(newCol, newRow)) return;
    this.manager.bombs.delete(`${this.col},${this.row}`);
    this.col = newCol;
    this.row = newRow;
    this.manager.bombs.set(`${this.col},${this.row}`, this);
    const pos = tileToPixel(newCol, newRow, TILE_SIZE);
    this.scene.tweens.add({ targets: this.sprite, x: pos.x, y: pos.y, duration: 130, ease: 'Linear' });
    audioManager.playKick();
  }

  destroy() {
    if (this._timerEvent) this._timerEvent.remove(false);
    if (this._warnEvent)  this._warnEvent.remove(false);
    if (this.sprite && this.sprite.active) this.sprite.destroy();
  }
}

export class BombManager {
  constructor(scene, map, onBlockDestroyed, onExplosionHit) {
    this.scene            = scene;
    this.map              = map;
    this.onBlockDestroyed = onBlockDestroyed;
    this.onExplosionHit   = onExplosionHit;
    this.onExplosionEvent = null; // set by GameScene in online host mode

    this.bombs      = new Map();
    this.explosions = new Set();
  }

  hasBombAt(col, row) { return this.bombs.has(`${col},${row}`); }

  placeBomb(col, row, owner) {
    if (this.hasBombAt(col, row)) return null;
    const bomb = new Bomb(this.scene, col, row, owner, this);
    this.bombs.set(`${col},${row}`, bomb);
    return bomb;
  }

  createExplosion(originCol, originRow, range, pierce, owner) {
    audioManager.playExplosion(range);

    // First pass: destroy blocks so map updates before final tile calculation
    const firstPass = calcExplosionTiles(this.map, originCol, originRow, range, pierce);
    for (const { col, row } of firstPass) {
      if (this.map[row]?.[col] === TILE.BLOCK) {
        this.map[row][col] = TILE.FLOOR;
        audioManager.playBlockDestroyed();
        if (this.onBlockDestroyed) this.onBlockDestroyed(col, row);
      }
    }

    // Second pass with updated map
    const tiles = calcExplosionTiles(this.map, originCol, originRow, range, pierce);

    for (const { col, row, type } of tiles) {
      this._spawnExplosionSprite(col, row, type);
      if (this.onExplosionHit) this.onExplosionHit(col, row, owner);
      const chainBomb = this.bombs.get(`${col},${row}`);
      if (chainBomb) this.scene.time.delayedCall(80, () => chainBomb.detonate());
    }

    if (this.onExplosionEvent) {
      this.onExplosionEvent({ col: originCol, row: originRow, range, pierce });
    }
  }

  _spawnExplosionSprite(col, row, type) {
    const pos    = tileToPixel(col, row, TILE_SIZE);
    const sprite = this.scene.add.sprite(pos.x, pos.y, `explosion_${type}`).setDepth(8);
    this.scene.tweens.add({
      targets: sprite, alpha: 0, scaleX: 1.3, scaleY: 1.3,
      duration: EXPLOSION_DURATION, ease: 'Power2',
      onComplete: () => { sprite.destroy(); this.explosions.delete(sprite); },
    });
    this.explosions.add(sprite);
  }

  _isKickable(col, row) {
    if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) return false;
    if (this.map[row][col] !== TILE.FLOOR) return false;
    if (this.hasBombAt(col, row)) return false;
    return true;
  }

  tryKickBomb(player, dx, dy) {
    if (!player.stats.kick) return;
    const { col, row } = player.tilePos;
    const bomb = this.bombs.get(`${col + Math.round(dx)},${row + Math.round(dy)}`);
    if (bomb && !bomb.exploded) bomb.kick(Math.round(dx), Math.round(dy));
  }

  serialize() {
    return [...this.bombs.values()].map(b => ({
      col: b.col, row: b.row, rem: Math.round(b.getRemaining()),
    }));
  }

  destroyAll() {
    for (const bomb of this.bombs.values()) bomb.destroy();
    this.bombs.clear();
  }
}
