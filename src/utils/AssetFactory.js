/**
 * AssetFactory — generates all game textures programmatically via Phaser's
 * Graphics API and converts them to named textures. No external image files needed.
 */
import { TILE_SIZE, PLAYER_COLORS } from '../data/constants.js';

const T = TILE_SIZE;

export function generateAssets(scene) {
  generateTiles(scene);
  generatePlayers(scene);
  generateBomb(scene);
  generateExplosion(scene);
  generateItems(scene);
  generateShadow(scene);
  generateUI(scene);
}

// ── Tiles ────────────────────────────────────────────────────────────────────

function generateTiles(scene) {
  // Floor tile
  const floor = scene.make.graphics({ x: 0, y: 0, add: false });
  floor.fillStyle(0x3d7a3d);
  floor.fillRect(0, 0, T, T);
  floor.lineStyle(1, 0x2d5a2d, 0.5);
  floor.strokeRect(0, 0, T, T);
  // subtle checkerboard
  floor.fillStyle(0x367036, 0.4);
  floor.fillRect(0, 0, T / 2, T / 2);
  floor.fillRect(T / 2, T / 2, T / 2, T / 2);
  floor.generateTexture('tile_floor', T, T);
  floor.destroy();

  // Indestructible wall
  const wall = scene.make.graphics({ x: 0, y: 0, add: false });
  wall.fillStyle(0x555577);
  wall.fillRect(0, 0, T, T);
  // 3D bevel top
  wall.fillStyle(0x7777aa);
  wall.fillRect(0, 0, T, 4);
  wall.fillRect(0, 0, 4, T);
  // 3D bevel bottom
  wall.fillStyle(0x333355);
  wall.fillRect(0, T - 4, T, 4);
  wall.fillRect(T - 4, 0, 4, T);
  // center pattern
  wall.fillStyle(0x444466);
  wall.fillRect(6, 6, T - 12, T - 12);
  wall.generateTexture('tile_wall', T, T);
  wall.destroy();

  // Destructible block
  const block = scene.make.graphics({ x: 0, y: 0, add: false });
  block.fillStyle(0xaa7733);
  block.fillRect(0, 0, T, T);
  block.fillStyle(0xcc9944);
  block.fillRect(0, 0, T, 4);
  block.fillRect(0, 0, 4, T);
  block.fillStyle(0x885522);
  block.fillRect(0, T - 4, T, 4);
  block.fillRect(T - 4, 0, 4, T);
  // wood grain lines
  block.lineStyle(1, 0x885522, 0.6);
  block.beginPath();
  block.moveTo(8, 4); block.lineTo(8, T - 4);
  block.moveTo(16, 4); block.lineTo(16, T - 4);
  block.moveTo(24, 4); block.lineTo(24, T - 4);
  block.moveTo(32, 4); block.lineTo(32, T - 4);
  block.moveTo(40, 4); block.lineTo(40, T - 4);
  block.strokePath();
  block.generateTexture('tile_block', T, T);
  block.destroy();
}

// ── Players ──────────────────────────────────────────────────────────────────

function _drawPlayerFrame(g, pc, ox, walkOffset, legOff) {
  // Shadow
  g.fillStyle(0x000000, 0.25);
  g.fillEllipse(ox + T / 2, T - 6, T * 0.65, 8);
  // Body
  g.fillStyle(pc.main);
  g.fillRoundedRect(ox + 10, 16 + walkOffset, T - 20, T - 24, 6);
  // Head
  g.fillStyle(0xffcc99);
  g.fillCircle(ox + T / 2, 16, 11);
  // Eyes
  g.fillStyle(0x222222);
  g.fillCircle(ox + T / 2 - 4, 14, 2);
  g.fillCircle(ox + T / 2 + 4, 14, 2);
  // Mouth
  g.fillStyle(0xaa4444);
  g.fillRect(ox + T / 2 - 3, 19, 6, 2);
  // Outfit detail
  g.fillStyle(pc.shadow);
  g.fillRect(ox + 12, 26 + walkOffset, T - 24, 4);
  // Legs
  g.fillStyle(0x333333);
  g.fillRoundedRect(ox + 12, T - 12 + legOff, 9, 8, 2);
  g.fillRoundedRect(ox + T - 21, T - 12 - legOff, 9, 8, 2);
  // Player number badge
  g.fillStyle(pc.shadow);
  g.fillCircle(ox + T - 10, 8, 8);
  g.fillStyle(0xffffff);
}

function generatePlayers(scene) {
  PLAYER_COLORS.forEach((pc, index) => {
    // Idle frame
    const gIdle = scene.make.graphics({ x: 0, y: 0, add: false });
    _drawPlayerFrame(gIdle, pc, 0, 0, 0);
    gIdle.generateTexture(`player_${index}_idle`, T, T);
    gIdle.destroy();

    // Walk frames — one texture per frame (avoids spritesheet rendering issues)
    for (let f = 0; f < 4; f++) {
      const walkOffset = Math.sin((f / 4) * Math.PI * 2) * 3;
      const legOff     = Math.sin((f / 4) * Math.PI * 2) * 4;
      const gWalk = scene.make.graphics({ x: 0, y: 0, add: false });
      _drawPlayerFrame(gWalk, pc, 0, walkOffset, legOff);
      gWalk.generateTexture(`player_${index}_walk_${f}`, T, T);
      gWalk.destroy();
    }

    // Death animation frame
    const dead = scene.make.graphics({ x: 0, y: 0, add: false });
    dead.fillStyle(pc.main, 0.7);
    dead.fillEllipse(T / 2, T - 12, T - 10, 20);
    dead.fillStyle(0xffffff, 0.4);
    dead.fillCircle(T / 2, T - 12, 8);
    dead.generateTexture(`player_${index}_dead`, T, T);
    dead.destroy();
  });
}

// ── Bomb ─────────────────────────────────────────────────────────────────────

function generateBomb(scene) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });

  // Shadow
  g.fillStyle(0x000000, 0.3);
  g.fillEllipse(T / 2, T - 6, T * 0.7, 10);

  // Body
  g.fillStyle(0x111111);
  g.fillCircle(T / 2, T / 2 - 2, T / 2 - 8);

  // Shine
  g.fillStyle(0x555555);
  g.fillCircle(T / 2 - 5, T / 2 - 8, 6);

  // Fuse
  g.lineStyle(3, 0x885522);
  g.beginPath();
  g.moveTo(T / 2, T / 2 - (T / 2 - 8));
  g.lineTo(T / 2 + 5, T / 2 - (T / 2 - 4));
  g.strokePath();

  // Spark
  g.fillStyle(0xffff00);
  g.fillCircle(T / 2 + 5, T / 2 - (T / 2 - 4), 3);
  g.fillStyle(0xff8800);
  g.fillCircle(T / 2 + 5, T / 2 - (T / 2 - 4), 2);

  g.generateTexture('bomb', T, T);
  g.destroy();
}

// ── Explosion ────────────────────────────────────────────────────────────────

function generateExplosion(scene) {
  // Center explosion tile
  ['center', 'middle_h', 'middle_v', 'end_up', 'end_down', 'end_left', 'end_right'].forEach((type) => {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    drawExplosionTile(g, type);
    g.generateTexture(`explosion_${type}`, T, T);
    g.destroy();
  });
}

function drawExplosionTile(g, type) {
  const half = T / 2;
  const thick = 14;

  // Core color gradient effect
  const colors = [0xffffff, 0xffff00, 0xff8800, 0xff4400];

  const drawBeam = (x1, y1, x2, y2, w) => {
    colors.forEach((c, i) => {
      const ww = w - i * 2;
      g.fillStyle(c, 1 - i * 0.1);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return;
      const nx = -dy / len * ww / 2;
      const ny = dx / len * ww / 2;
      g.fillTriangle(
        x1 + nx, y1 + ny, x1 - nx, y1 - ny,
        x2 + nx, y2 + ny
      );
      g.fillTriangle(
        x1 - nx, y1 - ny, x2 - nx, y2 - ny,
        x2 + nx, y2 + ny
      );
    });
  };

  switch (type) {
    case 'center':
      drawBeam(half, 0, half, T, thick);
      drawBeam(0, half, T, half, thick);
      break;
    case 'middle_h':
      drawBeam(0, half, T, half, thick);
      break;
    case 'middle_v':
      drawBeam(half, 0, half, T, thick);
      break;
    case 'end_up':
      drawBeam(half, half, half, 0, thick);
      break;
    case 'end_down':
      drawBeam(half, half, half, T, thick);
      break;
    case 'end_left':
      drawBeam(half, half, 0, half, thick);
      break;
    case 'end_right':
      drawBeam(half, half, T, half, thick);
      break;
  }

  // Bright core circle
  colors.forEach((c, i) => {
    g.fillStyle(c);
    g.fillCircle(half, half, thick / 2 - i * 2);
  });
}

// ── Items ────────────────────────────────────────────────────────────────────

const ITEM_CONFIGS = {
  bomb_up:  { bg: 0xdd2222, symbol: 'B+', emoji: '+' },
  fire_up:  { bg: 0xff6600, symbol: 'F+', emoji: '🔥' },
  speed_up: { bg: 0x2288ff, symbol: 'S+', emoji: '↑' },
  remote:   { bg: 0xaa22aa, symbol: 'RC', emoji: '📡' },
  pierce:   { bg: 0x22aaaa, symbol: 'P',  emoji: '⚡' },
  kick:     { bg: 0xaaaa22, symbol: 'K',  emoji: '👟' },
  skull:    { bg: 0x555555, symbol: '💀', emoji: '?' },
};

function generateItems(scene) {
  Object.entries(ITEM_CONFIGS).forEach(([name, cfg]) => {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    const pad = 6;
    const r = 6;

    // Shadow
    g.fillStyle(0x000000, 0.3);
    g.fillRoundedRect(pad + 2, pad + 2, T - pad * 2, T - pad * 2, r);

    // Background
    g.fillStyle(cfg.bg);
    g.fillRoundedRect(pad, pad, T - pad * 2, T - pad * 2, r);

    // Highlight
    g.fillStyle(0xffffff, 0.25);
    g.fillRoundedRect(pad + 2, pad + 2, T - pad * 2 - 4, 10, { tl: r - 1, tr: r - 1, bl: 0, br: 0 });

    // Border
    g.lineStyle(2, 0xffffff, 0.7);
    g.strokeRoundedRect(pad, pad, T - pad * 2, T - pad * 2, r);

    g.generateTexture(`item_${name}`, T, T);
    g.destroy();
  });
}

// ── Misc ─────────────────────────────────────────────────────────────────────

function generateShadow(scene) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  g.fillStyle(0x000000, 0.35);
  g.fillEllipse(T / 2, T / 2, T * 0.8, T * 0.3);
  g.generateTexture('shadow', T, T);
  g.destroy();
}

function generateUI(scene) {
  // Heart icon for lives
  const heart = scene.make.graphics({ x: 0, y: 0, add: false });
  heart.fillStyle(0xff2244);
  heart.fillCircle(7, 7, 6);
  heart.fillCircle(17, 7, 6);
  heart.fillTriangle(1, 9, 23, 9, 12, 22);
  heart.generateTexture('ui_heart', 24, 24);
  heart.destroy();

  // Bomb icon for HUD
  const hbomb = scene.make.graphics({ x: 0, y: 0, add: false });
  hbomb.fillStyle(0x111111);
  hbomb.fillCircle(10, 12, 9);
  hbomb.fillStyle(0xffff00);
  hbomb.fillCircle(14, 4, 3);
  hbomb.generateTexture('ui_bomb', 24, 24);
  hbomb.destroy();

  // Fire icon
  const hfire = scene.make.graphics({ x: 0, y: 0, add: false });
  hfire.fillStyle(0xff6600);
  hfire.fillTriangle(12, 2, 2, 22, 22, 22);
  hfire.fillStyle(0xffff00);
  hfire.fillTriangle(12, 6, 5, 20, 19, 20);
  hfire.generateTexture('ui_fire', 24, 24);
  hfire.destroy();
}
