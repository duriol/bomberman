import { TILE_SIZE, ITEM, ITEM_DROP_CHANCE, ITEM_WEIGHTS, ITEM_LIFETIME, ITEM_BLINK_THRESHOLD } from '../data/constants.js';
import { tileToPixel } from '../utils/MapGenerator.js';

/**
 * ItemManager — handles item spawning, rendering and pickup detection.
 */
export class ItemManager {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();  // key: "col,row"
  }

  /**
   * Maybe drop an item at (col, row) when a block is destroyed.
   */
  tryDrop(col, row) {
    if (Math.random() > ITEM_DROP_CHANCE) return;
    const type = this._rollItem();
    this._spawnItem(col, row, type);
  }

  /**
   * Force-spawn a specific item (used by remote clients to mirror host state).
   */
  forceSpawn(col, row, type) {
    this._spawnItem(col, row, type);
  }

  _rollItem() {
    const total = Object.values(ITEM_WEIGHTS).reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    for (const [type, weight] of Object.entries(ITEM_WEIGHTS)) {
      rand -= weight;
      if (rand <= 0) return type;
    }
    return ITEM.BOMB_UP;
  }

  _spawnItem(col, row, type) {
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

    const item = {
      col, row, type, sprite,
      lifetime: ITEM_LIFETIME,
      blinking: false,
    };

    this.items.set(key, item);

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
        player.applyItem(item.type);
        this.removeItem(item.col, item.row);
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
   */
  destroyAt(col, row) {
    this.removeItem(col, row);
  }

  destroyAll() {
    for (const item of this.items.values()) {
      this.scene.tweens.killTweensOf(item.sprite);
      item.sprite.destroy();
    }
    this.items.clear();
  }
}
