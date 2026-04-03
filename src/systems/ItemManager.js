import { TILE_SIZE, TILE, ITEM, ITEM_DROP_CHANCE, ITEM_WEIGHTS, ITEM_LIFETIME, ITEM_BLINK_THRESHOLD } from '../data/constants.js';
import { tileToPixel } from '../utils/MapGenerator.js';

const BOUNTY_ITEMS = new Set([ITEM.SKULL, ITEM.RUSH]);
const BOUNTY_USES  = 3;

/**
 * ItemManager — handles item spawning, rendering and pickup detection.
 */
export class ItemManager {
  constructor(scene, itemConfig = null) {
    this.scene = scene;
    this.items = new Map();  // key: "col,row"
    // Budget: copy of itemConfig counts; null means unlimited (local mode)
    this._budget = itemConfig ? { ...itemConfig } : null;
  }

  /**
   * Maybe drop an item at (col, row) when a block is destroyed.
   */
  tryDrop(col, row) {
    if (Math.random() > ITEM_DROP_CHANCE) return;
    const type = this._rollItem();
    if (!type) return;  // budget exhausted
    this._spawnItem(col, row, type);
  }

  /**
   * Force-spawn a specific item (used by remote clients to mirror host state).
   */
  forceSpawn(col, row, type) {
    this._spawnItem(col, row, type);
  }

  _rollItem() {
    if (this._budget) {
      // Only consider types that still have remaining budget
      const available = Object.entries(ITEM_WEIGHTS).filter(([type]) => (this._budget[type] || 0) > 0);
      if (available.length === 0) return null;
      const total = available.reduce((sum, [, w]) => sum + w, 0);
      let rand = Math.random() * total;
      for (const [type, weight] of available) {
        rand -= weight;
        if (rand <= 0) {
          this._budget[type]--;
          return type;
        }
      }
      // Fallback: pick first available
      const [type] = available[0];
      this._budget[type]--;
      return type;
    }

    // No budget: original unlimited behaviour
    const total = Object.values(ITEM_WEIGHTS).reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    for (const [type, weight] of Object.entries(ITEM_WEIGHTS)) {
      rand -= weight;
      if (rand <= 0) return type;
    }
    return ITEM.BOMB_UP;
  }

  _spawnItem(col, row, type, usesLeft = BOUNTY_USES) {
    const key = `${col},${row}`;
    if (this.items.has(key)) return;  // Already has an item

    const pos = tileToPixel(col, row, TILE_SIZE);
    const sprite = this.scene.add.sprite(pos.x, pos.y, `item_${type}`)
      .setDepth(3)
      .setScale(0.85);

    // Pop-in animation
    sprite.setScale(0);
    this.scene.tweens.add({
      targets: sprite,
      scale: 0.85,
      duration: 240,
      ease: 'Back.easeOut',
    });

    // Floating bob
    this.scene.tweens.add({
      targets: sprite,
      y: pos.y - 4,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const isBounty = BOUNTY_ITEMS.has(type);
    const item = {
      col, row, type, sprite,
      lifetime: ITEM_LIFETIME,
      blinking: false,
      bounty:   isBounty,
      usesLeft: isBounty ? usesLeft : undefined,
    };

    this.items.set(key, item);

    // Bounty items (skull/rush) never expire on their own
    if (!isBounty) {
      // Auto-expire after lifetime
      this.scene.time.addEvent({
        delay: ITEM_LIFETIME,
        callback: () => this.removeItem(col, row),
      });

      // Start blinking near end of lifetime
      this.scene.time.addEvent({
        delay: ITEM_LIFETIME - ITEM_BLINK_THRESHOLD,
        callback: () => {
          if (this.items.has(key)) {
            this._startBlink(item);
          }
        },
      });
    }
  }

  _startBlink(item) {
    if (item.blinking) return;
    item.blinking = true;
    this.scene.tweens.add({
      targets: item.sprite,
      alpha: 0.1,
      duration: 200,
      yoyo: true,
      repeat: -1,
    });
  }

  /**
   * Check if any player is overlapping an item and collect it.
   * @param {Player[]} players
   */
  checkPickups(players) {
    for (const player of players) {
      if (!player.alive) continue;
      const key = `${player.tilePos.col},${player.tilePos.row}`;
      if (this.items.has(key)) {
        const item = this.items.get(key);
        if (item.bounty) {
          // Bounty items: remove from map, apply effect, schedule reposition after effect ends
          const { type, usesLeft } = item;
          this.removeItem(item.col, item.row);
          player.applyItem(type);
          player._curseClearCallback = () => {
            if (usesLeft > 1) this._respawnBountyItem(type, usesLeft - 1);
          };
        } else {
          player.applyItem(item.type);
          this.removeItem(item.col, item.row);
        }
      }
    }
  }

  /**
   * Remove item (on pickup or expire or explosion).
   */
  removeItem(col, row) {
    const key = `${col},${row}`;
    const item = this.items.get(key);
    if (!item) return;
    this.scene.tweens.killTweensOf(item.sprite);
    this.scene.tweens.add({
      targets: item.sprite,
      scale: 0,
      alpha: 0,
      duration: 150,
      onComplete: () => item.sprite.destroy(),
    });
    this.items.delete(key);
  }

  /**
   * Called when an explosion hits a tile — destroys item if present.
   * Bounty items (skull/rush) are indestructible.
   */
  destroyAt(col, row) {
    const item = this.items.get(`${col},${row}`);
    if (item?.bounty) return;
    this.removeItem(col, row);
  }

  /** Respawn a bounty item at a random free floor tile. */
  _respawnBountyItem(type, usesLeft) {
    const pos = this._randomFloorTile();
    if (pos) this._spawnItem(pos.col, pos.row, type, usesLeft);
  }

  /** Pick a random FLOOR tile that isn’t already occupied by an item. */
  _randomFloorTile() {
    const map = this.scene.map;
    const floors = [];
    for (let r = 0; r < map.length; r++) {
      for (let c = 0; c < map[r].length; c++) {
        if (map[r][c] !== TILE.FLOOR) continue;
        if (this.items.has(`${c},${r}`)) continue;
        floors.push({ col: c, row: r });
      }
    }
    if (!floors.length) return null;
    return floors[Math.floor(Math.random() * floors.length)];
  }

  destroyAll() {
    for (const item of this.items.values()) {
      this.scene.tweens.killTweensOf(item.sprite);
      item.sprite.destroy();
    }
    this.items.clear();
  }
}
