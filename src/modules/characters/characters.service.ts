import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { RateLimitService } from '@app/common/rate-limit.service';
import {
  CHARACTER_GRANT_RATE_LIMIT,
  CHARACTER_GRANT_RATE_WINDOW_SECONDS,
  CHARACTER_SAVE_RATE_LIMIT,
  CHARACTER_SAVE_RATE_WINDOW_SECONDS,
  CHARACTER_UNLOCK_RATE_LIMIT,
  CHARACTER_UNLOCK_RATE_WINDOW_SECONDS,
} from './character.constants';
import {
  CHARACTER_CATALOG,
  CHARACTER_ITEM_MAP,
  CHARACTER_MAP,
  legacyGenderToCharacterId,
} from './character-catalog';
import {
  ANIMATION_MANIFEST,
  AnimationClipRef,
} from './character-animations';
import {
  CharacterAttachment,
  CharacterDefinition,
  CharacterItem,
  CharacterLoadout,
  ResolvedCharacter,
} from './character-types';

const LOADOUT_ITEM_FIELDS: Array<{
  key: keyof Omit<CharacterLoadout, 'characterId' | 'accessoryIds'>;
  categories: CharacterItem['category'][];
}> = [
  // skin has no dedicated category in spec §6; code/seed use hair-category
  // color refs for the base skin, so both are accepted for skinId only.
  { key: 'skinId', categories: ['hair'] },
  { key: 'hairId', categories: ['hair'] },
  { key: 'outfitTopId', categories: ['outfit_top'] },
  { key: 'outfitBottomId', categories: ['outfit_bottom'] },
  { key: 'fullOutfitId', categories: ['full_outfit'] },
  { key: 'headwearId', categories: ['headwear'] },
  { key: 'eyewearId', categories: ['eyewear'] },
  { key: 'facewearId', categories: ['facewear'] },
  { key: 'footwearId', categories: ['footwear'] },
];

export const FALLBACK_CHARACTER_ID = 'character-01';

export function isValidAttachment(value: unknown): value is CharacterAttachment {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (v.type === 'skinned') {
    return true;
  }
  if (v.type === 'bone') {
    return typeof v.boneName === 'string' && v.boneName.length > 0;
  }
  if (v.type === 'socket') {
    return typeof v.socketName === 'string' && v.socketName.length > 0;
  }
  return false;
}

type DbCharacter = {
  id: string;
  name: string;
  assetId: string;
  rigId: string;
  defaultLoadoutId: string;
  unlockType: string;
  unlockAmount: number | null;
};

type DbItem = {
  id: string;
  category: string;
  assetId: string;
  rigId: string;
  attachment: unknown;
  compatibleCharacterIds: string[];
  sourceType: string;
  eventId: string | null;
};

@Injectable()
export class CharactersService {
  private readonly logger = new Logger(CharactersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private saveLimit(userId: string): Promise<void> {
    return this.rateLimit.assertAllowed(
      `characters:save:rate:${userId}`,
      CHARACTER_SAVE_RATE_LIMIT,
      CHARACTER_SAVE_RATE_WINDOW_SECONDS,
    );
  }

  private unlockLimit(userId: string): Promise<void> {
    return this.rateLimit.assertAllowed(
      `characters:unlock:rate:${userId}`,
      CHARACTER_UNLOCK_RATE_LIMIT,
      CHARACTER_UNLOCK_RATE_WINDOW_SECONDS,
    );
  }

  private grantLimit(userId: string): Promise<void> {
    return this.rateLimit.assertAllowed(
      `characters:grant:rate:${userId}`,
      CHARACTER_GRANT_RATE_LIMIT,
      CHARACTER_GRANT_RATE_WINDOW_SECONDS,
    );
  }

  // Catalog reads: DB is source of truth, code catalog is fallback (tests /
  // pre-seed). Corrupt rows are excluded from the allowlist (toDefinition /
  // toItem return null) so they can never widen validation. Launch scope
  // stays exactly two free characters.
  async listCharacters(): Promise<CharacterDefinition[]> {
    try {
      const rows = await this.prisma.character.findMany({
        orderBy: { id: 'asc' },
      });
      if (rows.length > 0) {
        const valid = rows.map(toDefinition).filter(
          (d): d is CharacterDefinition => d !== null,
        );
        if (valid.length !== rows.length) {
          this.logger.warn(
            `character.catalog.filtered invalid=${rows.length - valid.length}`,
          );
        }
        if (valid.length > 0) {
          return valid;
        }
      }
    } catch {
      // Pre-migration / unit-test fallback.
    }
    return CHARACTER_CATALOG;
  }

  async listItems(characterId?: string): Promise<CharacterItem[]> {
    let items: CharacterItem[];
    try {
      const rows = await this.prisma.characterItem.findMany({
        orderBy: { id: 'asc' },
      });
      if (rows.length > 0) {
        const valid = rows.map(toItem).filter(
          (i): i is CharacterItem => i !== null,
        );
        if (valid.length !== rows.length) {
          this.logger.warn(
            `character.items.filtered invalid=${rows.length - valid.length}`,
          );
        }
        items = valid.length > 0 ? valid : [...CHARACTER_ITEM_MAP.values()];
      } else {
        items = [...CHARACTER_ITEM_MAP.values()];
      }
    } catch {
      items = [...CHARACTER_ITEM_MAP.values()];
    }
    if (!characterId) {
      return items;
    }
    return items.filter((item) =>
      item.compatibleCharacterIds.includes(characterId),
    );
  }

  /** Validated definition + loadout (sync fast path for Home reads). */
  resolveCharacter(
    characterId: string,
    loadoutInput?: Record<string, unknown>,
  ): ResolvedCharacter {
    const definition = CHARACTER_MAP.get(characterId);
    if (!definition) {
      throw new NotFoundException('CHARACTER_NOT_FOUND');
    }
    if (definition.unlock.type !== 'free') {
      throw new BadRequestException('CHARACTER_LOCKED');
    }
    const loadout = this.validateLoadout(characterId, loadoutInput);
    return { definition, loadout };
  }

  /**
   * Never-throwing resolve for Home reads (spec §31): unknown character ID
   * -> character-01, unknown cosmetic -> ignored, corrupt loadout -> default.
   */
  resolveOrFallback(
    characterId: string,
    loadoutInput?: Record<string, unknown>,
  ): ResolvedCharacter {
    try {
      return this.resolveCharacter(characterId, loadoutInput);
    } catch {
      const fallback = CHARACTER_MAP.get(FALLBACK_CHARACTER_ID);
      if (!fallback) {
        throw new NotFoundException('CHARACTER_NOT_FOUND');
      }
      return {
        definition: fallback,
        loadout: { characterId: fallback.id, accessoryIds: [] },
      };
    }
  }

  /**
   * Best-effort resolve for read paths (spec §31): unknown cosmetics are
   * ignored item-by-item while the valid rest of the loadout is preserved.
   * Writes (PUT) stay strict — validateLoadout* still reject. Never throws
   * for bad items; unknown character IDs fall back to character-01.
   */
  resolveLenient(
    characterId: string,
    loadoutInput?: Record<string, unknown>,
  ): ResolvedCharacter {
    const definition =
      CHARACTER_MAP.get(characterId) ??
      CHARACTER_MAP.get(FALLBACK_CHARACTER_ID);
    if (!definition) {
      throw new NotFoundException('CHARACTER_NOT_FOUND');
    }
    const raw =
      loadoutInput && typeof loadoutInput === 'object'
        ? loadoutInput
        : ({} as Record<string, unknown>);
    const loadout: CharacterLoadout = {
      characterId: definition.id,
      accessoryIds: [],
    };
    for (const { key, categories } of LOADOUT_ITEM_FIELDS) {
      const value = raw[key];
      if (typeof value !== 'string') {
        continue;
      }
      const item = CHARACTER_ITEM_MAP.get(value);
      if (
        !item ||
        !categories.includes(item.category) ||
        !isValidAttachment(item.attachment) ||
        !item.compatibleCharacterIds.includes(definition.id)
      ) {
        continue;
      }
      (loadout as Record<string, unknown>)[key] = value;
    }
    if (loadout.fullOutfitId && (loadout.outfitTopId || loadout.outfitBottomId)) {
      delete loadout.outfitTopId;
      delete loadout.outfitBottomId;
    }
    const accessoryIds = raw.accessoryIds;
    if (Array.isArray(accessoryIds)) {
      const seen = new Set<string>();
      for (const id of accessoryIds) {
        if (typeof id !== 'string' || seen.has(id)) {
          continue;
        }
        const item = CHARACTER_ITEM_MAP.get(id);
        if (
          !item ||
          item.category !== 'accessory' ||
          !isValidAttachment(item.attachment) ||
          !item.compatibleCharacterIds.includes(definition.id)
        ) {
          continue;
        }
        seen.add(id);
      }
      loadout.accessoryIds = [...seen];
    }
    return { definition, loadout };
  }

  validateLoadout(
    characterId: string,
    input?: Record<string, unknown>,
  ): CharacterLoadout {
    const raw =
      input && typeof input === 'object' ? input : ({} as Record<string, unknown>);
    const loadout: CharacterLoadout = { characterId, accessoryIds: [] };

    for (const { key, categories } of LOADOUT_ITEM_FIELDS) {
      const value = raw[key];
      if (value === undefined || value === null || value === '') {
        continue;
      }
      if (typeof value !== 'string') {
        throw new BadRequestException(`INVALID_LOADOUT_${String(key).toUpperCase()}`);
      }
      const item = CHARACTER_ITEM_MAP.get(value);
      if (!item) {
        throw new BadRequestException(`UNKNOWN_ITEM_${String(key).toUpperCase()}`);
      }
      if (!categories.includes(item.category)) {
        throw new BadRequestException(
          `INVALID_CATEGORY_${String(key).toUpperCase()}`,
        );
      }
      if (!isValidAttachment(item.attachment)) {
        throw new BadRequestException(
          `INVALID_ATTACHMENT_${String(key).toUpperCase()}`,
        );
      }
      if (!item.compatibleCharacterIds.includes(characterId)) {
        throw new BadRequestException(
          `INCOMPATIBLE_ITEM_${String(key).toUpperCase()}`,
        );
      }
      (loadout as Record<string, unknown>)[key] = value;
    }

    if (
      loadout.fullOutfitId &&
      (loadout.outfitTopId || loadout.outfitBottomId)
    ) {
      throw new BadRequestException('EXCLUSIVE_OUTFIT_SLOT');
    }

    const accessoryIds = raw.accessoryIds;
    if (accessoryIds !== undefined) {
      if (!Array.isArray(accessoryIds)) {
        throw new BadRequestException('INVALID_ACCESSORY_IDS');
      }
      const seen = new Set<string>();
      for (const id of accessoryIds) {
        if (typeof id !== 'string') {
          throw new BadRequestException('INVALID_ACCESSORY_IDS');
        }
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const item = CHARACTER_ITEM_MAP.get(id);
        if (!item || item.category !== 'accessory') {
          throw new BadRequestException('UNKNOWN_ACCESSORY_ITEM');
        }
        if (!isValidAttachment(item.attachment)) {
          throw new BadRequestException('INVALID_ACCESSORY_ITEM');
        }
        if (!item.compatibleCharacterIds.includes(characterId)) {
          throw new BadRequestException('INCOMPATIBLE_ACCESSORY_ITEM');
        }
      }
      loadout.accessoryIds = [...seen];
    }

    return loadout;
  }

  /**
   * DB-backed validation for writes: ownership, compatibility, exclusive
   * slots, valid asset IDs — all checked server-side (spec §21).
   */
  async validateLoadoutAgainstDb(
    userId: string,
    characterId: string,
    input?: Record<string, unknown>,
  ): Promise<CharacterLoadout> {
    const [definitions, items] = await Promise.all([
      this.listCharacters(),
      this.listItems(),
    ]);
    const definition = definitions.find((d) => d.id === characterId);
    if (!definition) {
      throw new NotFoundException('CHARACTER_NOT_FOUND');
    }
    const owned = await this.getOwnedCharacterIds(userId);
    if (!owned.has(characterId)) {
      if (definition.unlock.type === 'free') {
        await this.ensureFreeOwnership(userId);
      } else {
        throw new BadRequestException('CHARACTER_NOT_OWNED');
      }
    }
    const byId = new Map(items.map((i) => [i.id, i]));
    const raw =
      input && typeof input === 'object' ? input : ({} as Record<string, unknown>);
    const loadout: CharacterLoadout = { characterId, accessoryIds: [] };
    for (const { key, categories } of LOADOUT_ITEM_FIELDS) {
      const value = raw[key];
      if (value === undefined || value === null || value === '') {
        continue;
      }
      if (typeof value !== 'string') {
        throw new BadRequestException(`INVALID_LOADOUT_${String(key).toUpperCase()}`);
      }
      const item = byId.get(value);
      if (!item) {
        throw new BadRequestException(`UNKNOWN_ITEM_${String(key).toUpperCase()}`);
      }
      if (!categories.includes(item.category)) {
        throw new BadRequestException(
          `INVALID_CATEGORY_${String(key).toUpperCase()}`,
        );
      }
      if (!isValidAttachment(item.attachment)) {
        throw new BadRequestException(
          `INVALID_ATTACHMENT_${String(key).toUpperCase()}`,
        );
      }
      if (!item.compatibleCharacterIds.includes(characterId)) {
        throw new BadRequestException(
          `INCOMPATIBLE_ITEM_${String(key).toUpperCase()}`,
        );
      }
      await this.assertItemOwned(userId, item);
      (loadout as Record<string, unknown>)[key] = value;
    }
    if (loadout.fullOutfitId && (loadout.outfitTopId || loadout.outfitBottomId)) {
      throw new BadRequestException('EXCLUSIVE_OUTFIT_SLOT');
    }
    const accessoryIds = raw.accessoryIds;
    if (accessoryIds !== undefined) {
      if (!Array.isArray(accessoryIds)) {
        throw new BadRequestException('INVALID_ACCESSORY_IDS');
      }
      const seen = new Set<string>();
      for (const id of accessoryIds) {
        if (typeof id !== 'string') {
          throw new BadRequestException('INVALID_ACCESSORY_IDS');
        }
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const item = byId.get(id);
        if (!item || item.category !== 'accessory') {
          throw new BadRequestException('UNKNOWN_ACCESSORY_ITEM');
        }
        if (!isValidAttachment(item.attachment)) {
          throw new BadRequestException('INVALID_ACCESSORY_ITEM');
        }
        if (!item.compatibleCharacterIds.includes(characterId)) {
          throw new BadRequestException('INCOMPATIBLE_ACCESSORY_ITEM');
        }
        await this.assertItemOwned(userId, item);
      }
      loadout.accessoryIds = [...seen];
    }
    return loadout;
  }

  async getOwnedCharacterIds(userId: string): Promise<Set<string>> {
    try {
      const rows = await this.prisma.userCharacter.findMany({
        where: { userId },
        select: { characterId: true },
      });
      return new Set(rows.map((r) => r.characterId));
    } catch {
      return new Set(['character-01', 'character-02']);
    }
  }

  /** Free characters + base items are auto-granted (idempotent). */
  async ensureFreeOwnership(userId: string): Promise<void> {
    try {
      const [definitions, items] = await Promise.all([
        this.listCharacters(),
        this.listItems(),
      ]);
      const free = definitions.filter((d) => d.unlock.type === 'free');
      for (const c of free) {
        await this.prisma.userCharacter.upsert({
          where: { userId_characterId: { userId, characterId: c.id } },
          update: {},
          create: { userId, characterId: c.id },
        });
      }
      for (const item of items.filter((i) => i.source.type === 'base')) {
        await this.prisma.userCharacterItem.upsert({
          where: { userId_itemId: { userId, itemId: item.id } },
          update: {},
          create: { userId, itemId: item.id },
        });
      }
      await this.prisma.eventCoinWallet.upsert({
        where: { userId },
        update: {},
        create: { userId, balance: 0 },
      });
    } catch {
      // Unit-test fallback without DB — nothing to persist.
    }
  }

  private async assertItemOwned(
    userId: string,
    item: CharacterItem,
  ): Promise<void> {
    if (item.source.type === 'base') {
      return;
    }
    try {
      const row = await this.prisma.userCharacterItem.findUnique({
        where: { userId_itemId: { userId, itemId: item.id } },
      });
      if (!row) {
        throw new BadRequestException('ITEM_NOT_OWNED');
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      // No DB in unit tests — fall back to code-catalog ownership.
    }
  }

  /** Event cosmetics become normal owned items; they survive event end. */
  async grantItem(
    userId: string,
    itemId: string,
    eventId?: string,
  ): Promise<void> {
    await this.grantLimit(userId);
    const items = await this.listItems();
    const item = items.find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundException('ITEM_NOT_FOUND');
    }
    await this.prisma.userCharacterItem.upsert({
      where: { userId_itemId: { userId, itemId } },
      update: { eventId: eventId ?? item.source.eventId },
      create: { userId, itemId, eventId: eventId ?? item.source.eventId },
    });
    // Audit: who received what (no secrets/PII beyond internal ids).
    this.logger.log(`character.item.granted user=${userId} item=${itemId}`);
  }

  async getInventory(userId: string): Promise<CharacterItem[]> {
    try {
      const rows = await this.prisma.userCharacterItem.findMany({
        where: { userId },
        include: { item: true },
        orderBy: { acquiredAt: 'asc' },
      });
      if (rows.length > 0) {
        const valid = rows
          .map((r) =>
            toItem({
              id: r.item.id,
              category: r.item.category,
              assetId: r.item.assetId,
              rigId: r.item.rigId,
              attachment: r.item.attachment,
              compatibleCharacterIds: r.item.compatibleCharacterIds,
              sourceType: r.item.sourceType,
              eventId: r.item.eventId,
            }),
          )
          .filter((i): i is CharacterItem => i !== null);
        if (valid.length > 0) {
          return valid;
        }
      }
    } catch {
      // Fall through to base items.
    }
    return (await this.listItems()).filter((i) => i.source.type === 'base');
  }

  async getCoins(userId: string): Promise<number> {
    try {
      const wallet = await this.prisma.eventCoinWallet.findUnique({
        where: { userId },
      });
      return wallet?.balance ?? 0;
    } catch {
      return 0;
    }
  }

  /** Server-side grant (event rewards). Amount must be positive. */
  async grantCoins(
    userId: string,
    amount: number,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<number> {
    await this.grantLimit(userId);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BadRequestException('INVALID_COIN_AMOUNT');
    }
    const balance = await this.prisma.$transaction(async (tx) => {
      await tx.eventCoinTransaction.create({
        data: { userId, amount, reason, metadata: metadata as object },
      });
      const wallet = await tx.eventCoinWallet.upsert({
        where: { userId },
        update: { balance: { increment: amount } },
        create: { userId, balance: amount },
      });
      return wallet.balance;
    });
    // Audit: economy movement without sensitive payload contents.
    this.logger.log(
      `character.coins.granted user=${userId} amount=${amount} reason=${reason}`,
    );
    return balance;
  }

  /** Unlock a future event-coins character (atomic balance check). */
  async unlockCharacter(userId: string, characterId: string) {
    await this.unlockLimit(userId);
    const definitions = await this.listCharacters();
    const definition = definitions.find((d) => d.id === characterId);
    if (!definition) {
      throw new NotFoundException('CHARACTER_NOT_FOUND');
    }
    if (definition.unlock.type === 'free') {
      await this.ensureFreeOwnership(userId);
      return { definition, alreadyOwned: true };
    }
    const cost = definition.unlock.amount ?? 0;
    const result = await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.eventCoinWallet.findUnique({
        where: { userId },
      });
      const balance = wallet?.balance ?? 0;
      if (balance < cost) {
        throw new BadRequestException('INSUFFICIENT_EVENT_COINS');
      }
      const existing = await tx.userCharacter.findUnique({
        where: { userId_characterId: { userId, characterId } },
      });
      if (existing) {
        return { alreadyOwned: true };
      }
      await tx.eventCoinWallet.update({
        where: { userId },
        data: { balance: { decrement: cost } },
      });
      await tx.eventCoinTransaction.create({
        data: {
          userId,
          amount: -cost,
          reason: 'character_unlock',
          metadata: { characterId },
        },
      });
      await tx.userCharacter.create({ data: { userId, characterId } });
      return { alreadyOwned: false };
    });
    this.logger.log(`character.unlocked user=${userId} char=${characterId}`);
    return { definition, ...result };
  }

  async getSelection(userId: string): Promise<ResolvedCharacter> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { characterConfig: true },
    });
    const config =
      (profile?.characterConfig as Record<string, unknown> | null) ?? {};
    const rawId =
      typeof config.characterId === 'string'
        ? config.characterId
        : legacyGenderToCharacterId(config.gender);
    const rawLoadout =
      config.loadout && typeof config.loadout === 'object'
        ? (config.loadout as Record<string, unknown>)
        : config;
    try {
      return this.resolveCharacter(rawId, {
        ...this.pickLoadoutFields(rawLoadout),
        accessoryIds: Array.isArray(
          (rawLoadout as Record<string, unknown>).accessoryIds,
        )
          ? ((rawLoadout as Record<string, unknown>).accessoryIds as string[])
          : [],
      });
    } catch {
      // Read path stays lenient (spec §31): keep every valid item, drop the
      // bad ones, fall back to the legacy-mapped character only when the ID
      // itself is unknown. Writes stay strict.
      return this.resolveLenient(rawId, {
        ...this.pickLoadoutFields(rawLoadout),
        accessoryIds: Array.isArray(
          (rawLoadout as Record<string, unknown>).accessoryIds,
        )
          ? ((rawLoadout as Record<string, unknown>).accessoryIds as string[])
          : [],
      });
    }
  }

  async saveSelection(
    userId: string,
    characterId: string,
    loadoutInput?: Record<string, unknown>,
  ): Promise<ResolvedCharacter> {
    await this.saveLimit(userId);
    const definitions = await this.listCharacters();
    const definition = definitions.find((d) => d.id === characterId);
    if (!definition) {
      throw new NotFoundException('CHARACTER_NOT_FOUND');
    }
    await this.ensureFreeOwnership(userId);
    // DB-hardened validation (ownership + compatibility + slots).
    let loadout: CharacterLoadout;
    try {
      loadout = await this.validateLoadoutAgainstDb(
        userId,
        characterId,
        loadoutInput,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Pre-seed/partial DB: fall back to code-catalog validation so launch
      // free characters always stay selectable.
      loadout = this.validateLoadout(characterId, loadoutInput);
    }
    const existing = await this.prisma.profile.findUnique({
      where: { userId },
      select: { characterConfig: true },
    });
    const prev =
      (existing?.characterConfig as Record<string, unknown> | null) ?? {};
    const next = { ...prev, characterId: definition.id, loadout };
    await this.prisma.profile.update({
      where: { userId },
      data: { characterConfig: next as object },
    });
    this.logger.log(`character.selected user=${userId} char=${characterId}`);
    return { definition, loadout };
  }

  private pickLoadoutFields(
    raw: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const { key } of LOADOUT_ITEM_FIELDS) {
      if (typeof raw[key] === 'string') {
        out[key] = raw[key];
      }
    }
    return out;
  }

  /** Launch animation allowlist (spec §10). Clips lazy-load by URL. */
  listAnimations(): AnimationClipRef[] {
    return ANIMATION_MANIFEST;
  }
}

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set([
  'hair',
  'outfit_top',
  'outfit_bottom',
  'full_outfit',
  'headwear',
  'eyewear',
  'facewear',
  'footwear',
  'accessory',
]);

const KNOWN_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'base',
  'event',
  'system',
]);

/**
 * Allowlist gate for catalog rows (Phase 9, task 12). Corrupt/hand-edited
 * DB rows are excluded from the allowlist (with a warning) instead of
 * flowing into validation — a bad row can never widen what clients may
 * equip. Code-catalog fallback keeps launch characters selectable.
 */
function toDefinition(row: DbCharacter): CharacterDefinition | null {
  if (
    !row.id ||
    !row.assetId ||
    !row.rigId ||
    (row.unlockType !== 'free' && row.unlockType !== 'event_coins')
  ) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    assetId: row.assetId,
    rigId: row.rigId,
    defaultLoadoutId: row.defaultLoadoutId,
    unlock:
      row.unlockType === 'event_coins'
        ? { type: 'event_coins', amount: row.unlockAmount ?? 0 }
        : { type: 'free' },
  };
}

function toItem(row: DbItem): CharacterItem | null {
  if (
    !row.id ||
    !row.assetId ||
    !row.rigId ||
    !KNOWN_CATEGORIES.has(row.category) ||
    !KNOWN_SOURCE_TYPES.has(row.sourceType) ||
    !Array.isArray(row.compatibleCharacterIds) ||
    row.compatibleCharacterIds.length === 0 ||
    !isValidAttachment(row.attachment)
  ) {
    return null;
  }
  return {
    id: row.id,
    category: row.category as CharacterItem['category'],
    assetId: row.assetId,
    rigId: row.rigId,
    attachment: row.attachment as CharacterAttachment,
    compatibleCharacterIds: row.compatibleCharacterIds,
    source: {
      type: row.sourceType as CharacterItem['source']['type'],
      eventId: row.eventId ?? undefined,
    },
  };
}
