// ============================================================
// CONSTANTS & GAME CONFIG
// ============================================================

export const TILE_SIZE = 48;
export const MAP_COLS = 15;
export const MAP_ROWS = 13;

export const GAME_WIDTH = MAP_COLS * TILE_SIZE;     // 720
export const GAME_HEIGHT = MAP_ROWS * TILE_SIZE;    // 624
export const HUD_HEIGHT = 56;
export const CANVAS_HEIGHT = GAME_HEIGHT + HUD_HEIGHT;

// Tile types
export const TILE = {
  FLOOR: 0,
  WALL: 1,      // indestructible
  BLOCK: 2,     // destructible
  SPAWN: 3,
};

// Item types
export const ITEM = {
  BOMB_UP:    'bomb_up',     // +1 bomb capacity
  FIRE_UP:    'fire_up',     // +1 explosion range
  SPEED_UP:   'speed_up',    // +movement speed
  MULTI_BOMB: 'multi_bomb',  // place all bombs in facing direction
  KICK:       'kick',        // kick bombs
  SKULL:      'skull',       // random curse: random movement
  RUSH:       'rush',        // curse: locked direction at high speed until wall
};

// Player colors (Bomberman 4 style)
export const PLAYER_COLORS = [
  { main: 0xffffff, shadow: 0xaaaaaa, label: 'White',  keys: 'WASD+Space'       },
  { main: 0x111199, shadow: 0x0000aa, label: 'Blue',   keys: 'Arrows+Enter'     },
  { main: 0xcc2222, shadow: 0x880000, label: 'Red',    keys: 'IJKL+U'          },
  { main: 0x22aa22, shadow: 0x007700, label: 'Green',  keys: 'Numpad8456+0'     },
  { main: 0xffaa00, shadow: 0xcc6600, label: 'Yellow', keys: 'TFGH+R'           },
];

// Default player stats
export const DEFAULT_PLAYER_STATS = {
  maxBombs: 1,
  bombRange: 2,
  speed: 160,   // px/s
  lives: 1,
  kick: false,
  multiStar: false,  // multi-bomb in facing direction
};

// Timing (ms)
export const BOMB_TIMER = 3000;
export const EXPLOSION_DURATION = 600;
export const ITEM_BLINK_THRESHOLD = 8000;
export const ITEM_LIFETIME = 15000;
export const RESPAWN_DELAY = 2500;
export const ROUND_TIME = 180;  // seconds

// Spawn corners (col, row)
export const SPAWN_POSITIONS = [
  { col: 1,            row: 1            },  // P1 top-left
  { col: MAP_COLS - 2, row: MAP_ROWS - 2 },  // P2 bottom-right
  { col: MAP_COLS - 2, row: 1            },  // P3 top-right
  { col: 1,            row: MAP_ROWS - 2 },  // P4 bottom-left
  { col: Math.floor(MAP_COLS / 2), row: Math.floor(MAP_ROWS / 2) }, // P5 center
];

// Item drop probabilities (0–1)
export const ITEM_DROP_CHANCE = 0.5;
export const ITEM_WEIGHTS = {
  [ITEM.BOMB_UP]:    30,
  [ITEM.FIRE_UP]:    30,
  [ITEM.SPEED_UP]:   20,
  [ITEM.KICK]:       10,
  [ITEM.MULTI_BOMB]: 6,
  [ITEM.SKULL]:      2,
  [ITEM.RUSH]:       2,
};
