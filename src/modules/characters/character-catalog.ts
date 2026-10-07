// Launch catalog: exactly two free characters (spec §5).
// assetId points at the existing GLBs so current rendering keeps working.
// rigId is stable across both so future animations/equipment stay compatible.

import {
  CharacterDefinition,
  CharacterItem,
} from './character-types';

export const RIG_ID = 'humanoid-v1';

export const CHARACTER_CATALOG: CharacterDefinition[] = [
  {
    id: 'character-01',
    name: 'Aria',
    assetId: '/character-scene/female.glb',
    rigId: RIG_ID,
    defaultLoadoutId: 'loadout-character-01-base',
    unlock: { type: 'free' },
  },
  {
    id: 'character-02',
    name: 'Kai',
    assetId: '/character-scene/male.glb',
    rigId: RIG_ID,
    defaultLoadoutId: 'loadout-character-02-base',
    unlock: { type: 'free' },
  },
];

export const CHARACTER_MAP = new Map(
  CHARACTER_CATALOG.map((c) => [c.id, c]),
);

// Base items only. Event cosmetics arrive later as source: 'event' entries
// with the same shape — no renderer change required.
// NOTE: assetId values are compatibility fallbacks (/character-scene/*.glb,
// procedural/color refs). Final Quaternius GLBs live under
// /hirotoli/characters/... after Phase 1 art approval (see
// assets/licenses/*). Stable IDs (character-01/character-02) never change.
export const CHARACTER_ITEMS: CharacterItem[] = [
  {
    id: 'skin-base-01',
    category: 'hair',
    assetId: 'color-skin-base',
    rigId: RIG_ID,
    attachment: { type: 'skinned' },
    compatibleCharacterIds: ['character-01', 'character-02'],
    source: { type: 'base' },
  },
  {
    id: 'hair-base-01',
    category: 'hair',
    assetId: 'color-hair-base',
    rigId: RIG_ID,
    attachment: { type: 'skinned' },
    compatibleCharacterIds: ['character-01', 'character-02'],
    source: { type: 'base' },
  },
  {
    id: 'outfit-top-base-01',
    category: 'outfit_top',
    assetId: 'color-outfit-top-base',
    rigId: RIG_ID,
    attachment: { type: 'skinned' },
    compatibleCharacterIds: ['character-01', 'character-02'],
    source: { type: 'base' },
  },
  {
    id: 'outfit-bottom-base-01',
    category: 'outfit_bottom',
    assetId: 'color-outfit-bottom-base',
    rigId: RIG_ID,
    attachment: { type: 'skinned' },
    compatibleCharacterIds: ['character-01', 'character-02'],
    source: { type: 'base' },
  },
  {
    id: 'headwear-base-cap-01',
    category: 'headwear',
    assetId: 'procedural-cap-01',
    rigId: RIG_ID,
    attachment: { type: 'socket', socketName: 'headTop' },
    compatibleCharacterIds: ['character-01', 'character-02'],
    source: { type: 'base' },
  },
  {
    id: 'eyewear-base-glasses-01',
    category: 'eyewear',
    assetId: 'procedural-glasses-01',
    rigId: RIG_ID,
    attachment: { type: 'socket', socketName: 'faceFront' },
    compatibleCharacterIds: ['character-01', 'character-02'],
    source: { type: 'base' },
  },
  {
    id: 'full-outfit-base-01',
    category: 'full_outfit',
    assetId: 'color-full-outfit-base',
    rigId: RIG_ID,
    attachment: { type: 'skinned' },
    compatibleCharacterIds: ['character-01', 'character-02'],
    source: { type: 'base' },
  },
];

export const CHARACTER_ITEM_MAP = new Map(
  CHARACTER_ITEMS.map((i) => [i.id, i]),
);

// Legacy gender -> launch character. Keeps old { gender: 'male'|'female' }
// configs rendering after the migration (dual-read, no break).
export function legacyGenderToCharacterId(
  gender: unknown,
): string {
  return gender === 'male' ? 'character-02' : 'character-01';
}
