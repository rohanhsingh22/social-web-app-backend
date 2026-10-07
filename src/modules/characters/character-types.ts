// HiRotoli character system — production types (doc/hirotoli-character-and-theme.txt §6-8).
// Additive Phase 1: catalog lives in code, selection persists inside the
// existing Profile.characterConfig JSON (no migration, no Home break).
// Proper Character/CharacterItem tables can replace the catalog later
// without changing these shapes.

export type CharacterUnlock =
  | { type: 'free' }
  | { type: 'event_coins'; amount: number };

export type CharacterDefinition = {
  id: string;
  name: string;
  assetId: string;
  rigId: string;
  defaultLoadoutId: string;
  unlock: CharacterUnlock;
};

export type CharacterLoadout = {
  characterId: string;
  skinId?: string;
  hairId?: string;
  outfitTopId?: string;
  outfitBottomId?: string;
  fullOutfitId?: string;
  headwearId?: string;
  eyewearId?: string;
  facewearId?: string;
  footwearId?: string;
  accessoryIds: string[];
};

export type CharacterItemCategory =
  | 'hair'
  | 'outfit_top'
  | 'outfit_bottom'
  | 'full_outfit'
  | 'headwear'
  | 'eyewear'
  | 'facewear'
  | 'footwear'
  | 'accessory';

export type CharacterAttachment =
  | { type: 'skinned' }
  | { type: 'bone'; boneName: string }
  | { type: 'socket'; socketName: string };

export type CharacterItem = {
  id: string;
  category: CharacterItemCategory;
  assetId: string;
  rigId: string;
  attachment: CharacterAttachment;
  compatibleCharacterIds: string[];
  source: { type: 'base' | 'event' | 'system'; eventId?: string };
};

export type ResolvedCharacter = {
  definition: CharacterDefinition;
  loadout: CharacterLoadout;
};
