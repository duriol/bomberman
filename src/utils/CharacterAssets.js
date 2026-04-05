import {
  CHARACTER_DEFS,
  CHARACTER_IDS,
  DEFAULT_CHARACTER_ID,
  TILE_SIZE,
} from '../data/constants.js';

function _runtimeBasePath() {
  const envBase = import.meta.env.BASE_URL || '/';
  let runtimeBase = new URL('.', window.location.href).pathname;
  if (runtimeBase === '/' && window.location.pathname && window.location.pathname !== '/') {
    runtimeBase = window.location.pathname.endsWith('/')
      ? window.location.pathname
      : `${window.location.pathname}/`;
  }
  const baseUrl = (envBase === '/' && runtimeBase !== '/') ? runtimeBase : envBase;
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

export function normalizeCharacterId(characterId) {
  const id = String(characterId || '').toLowerCase();
  return CHARACTER_DEFS[id] ? id : DEFAULT_CHARACTER_ID;
}

export function getCharacterDef(characterId) {
  const id = normalizeCharacterId(characterId);
  return CHARACTER_DEFS[id];
}

export function getCharacterIdleKey(characterId, facing = 'down') {
  const def = getCharacterDef(characterId);
  if (facing === 'up') return def.idle.up;
  if (facing === 'right' || facing === 'left') return def.idle.right;
  return def.idle.down;
}

export function getCharacterWalkFrameCount(characterId, facing = 'down') {
  const def = getCharacterDef(characterId);
  if (facing === 'left' || facing === 'right') return def.walkFrames.right;
  if (facing === 'up') return def.walkFrames.up;
  return def.walkFrames.down;
}

export function getCharacterWalkKey(characterId, facing = 'down', frame = 0) {
  const def = getCharacterDef(characterId);
  const frameIndex = Math.max(1, Math.floor(frame) + 1);
  if (facing === 'up') return `${def.walkBase.up}${frameIndex}`;
  if (facing === 'left' || facing === 'right') return `${def.walkBase.right}${frameIndex}`;
  return `${def.walkBase.down}${frameIndex}`;
}

export function getCharacterScale(scene, characterId, facing = 'down') {
  const def = getCharacterDef(characterId);
  const idleKey = getCharacterIdleKey(characterId, facing);
  const source = scene.textures.get(idleKey)?.getSourceImage?.();
  const spriteHeight = source?.height || def.spriteHeight || TILE_SIZE;
  if (!spriteHeight) return 1;
  return TILE_SIZE / spriteHeight;
}

export function preloadCharacterSets(scene, characterIds = CHARACTER_IDS) {
  const base = _runtimeBasePath();
  const list = Array.isArray(characterIds) && characterIds.length ? characterIds : CHARACTER_IDS;
  const unique = [...new Set(list.map(normalizeCharacterId))];

  unique.forEach((id) => {
    const def = getCharacterDef(id);
    const folderBase = `${base}assets/sprites/${def.folder}`;

    const idleKeys = [def.idle.down, def.idle.right, def.idle.up];
    idleKeys.forEach((key) => {
      if (!scene.textures.exists(key)) {
        scene.load.image(key, `${folderBase}/${key}.png`);
      }
    });

    const walkRows = [
      { baseKey: def.walkBase.down, count: def.walkFrames.down },
      { baseKey: def.walkBase.up, count: def.walkFrames.up },
      { baseKey: def.walkBase.right, count: def.walkFrames.right },
    ];

    walkRows.forEach(({ baseKey, count }) => {
      for (let i = 1; i <= count; i++) {
        const key = `${baseKey}${i}`;
        if (!scene.textures.exists(key)) {
          scene.load.image(key, `${folderBase}/${key}.png`);
        }
      }
    });
  });
}
