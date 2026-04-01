import { TILE, MAP_COLS, MAP_ROWS, SPAWN_POSITIONS } from '../data/constants.js';

/**
 * Mulberry32 seeded pseudo-random number generator.
 * Returns a function that produces deterministic values in [0,1).
 * @param {number} seed  32-bit unsigned integer
 */
export function createRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a classic Bomberman-style grid map.
 * - Border + alternating internal columns/rows are indestructible walls.
 * - Spawn corners (3x3 area) are always cleared for fairness.
 * - Remaining interior tiles have a chance to be destructible blocks.
 * @param {number}   blockDensity  0–1 probability for each open tile to be a block
 * @param {function} rng           random function (default Math.random; use createRng for determinism)
 */
export function generateMap(blockDensity = 0.75, rng = Math.random) {
  const map = [];

  for (let row = 0; row < MAP_ROWS; row++) {
    map[row] = [];
    for (let col = 0; col < MAP_COLS; col++) {
      // Border walls
      if (row === 0 || row === MAP_ROWS - 1 || col === 0 || col === MAP_COLS - 1) {
        map[row][col] = TILE.WALL;
      }
      // Alternating fixed inner walls (classic Bomberman grid)
      else if (row % 2 === 0 && col % 2 === 0) {
        map[row][col] = TILE.WALL;
      }
      else {
        map[row][col] = TILE.FLOOR;
      }
    }
  }

  // Place random destructible blocks
  for (let row = 1; row < MAP_ROWS - 1; row++) {
    for (let col = 1; col < MAP_COLS - 1; col++) {
      if (map[row][col] === TILE.FLOOR) {
        if (rng() < blockDensity) {
          map[row][col] = TILE.BLOCK;
        }
      }
    }
  }

  // Clear spawn areas (2-tile radius around each spawn corner) for all 5 players
  for (const spawn of SPAWN_POSITIONS) {
    const clearZone = getClearZone(spawn.col, spawn.row);
    for (const { r, c } of clearZone) {
      if (r > 0 && r < MAP_ROWS - 1 && c > 0 && c < MAP_COLS - 1) {
        if (map[r][c] !== TILE.WALL) {
          map[r][c] = TILE.FLOOR;
        }
      }
    }
  }

  return map;
}

/**
 * Returns the cells to clear around a spawn position (L-shape pattern).
 */
function getClearZone(col, row) {
  return [
    { r: row,     c: col     },
    { r: row + 1, c: col     },
    { r: row - 1, c: col     },
    { r: row,     c: col + 1 },
    { r: row,     c: col - 1 },
    { r: row + 1, c: col + 1 },
    { r: row - 1, c: col - 1 },
    { r: row + 1, c: col - 1 },
    { r: row - 1, c: col + 1 },
  ];
}

/**
 * Convert pixel coords to grid col/row (floor).
 */
export function pixelToTile(x, y, tileSize) {
  return {
    col: Math.floor(x / tileSize),
    row: Math.floor(y / tileSize),
  };
}

/**
 * Convert grid col/row to pixel center coords.
 */
export function tileToPixel(col, row, tileSize) {
  return {
    x: col * tileSize + tileSize / 2,
    y: row * tileSize + tileSize / 2,
  };
}

/**
 * Check if a tile is passable (no solid).
 */
export function isWalkable(map, col, row) {
  if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return false;
  return map[row][col] === TILE.FLOOR || map[row][col] === TILE.SPAWN;
}
