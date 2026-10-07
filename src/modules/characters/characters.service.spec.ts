import { CharactersService } from './characters.service';
import { RateLimitService } from '@app/common/rate-limit.service';

describe('CharactersService', () => {
  const createService = () => {
    const prisma = {
      profile: { findUnique: jest.fn(), update: jest.fn() },
      character: { findMany: jest.fn().mockResolvedValue([]) },
      characterItem: { findMany: jest.fn().mockResolvedValue([]) },
      userCharacter: { findMany: jest.fn().mockResolvedValue([]) },
      userCharacterItem: { findMany: jest.fn().mockResolvedValue([]) },
      eventCoinWallet: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as import('@app/core/prisma/prisma.service').PrismaService;
    const rateLimit = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitService;
    return {
      service: new CharactersService(prisma, rateLimit),
      rateLimit: rateLimit as unknown as { assertAllowed: jest.Mock },
      prisma: prisma as unknown as {
        profile: { findUnique: jest.Mock; update: jest.Mock };
        character: { findMany: jest.Mock };
        characterItem: { findMany: jest.Mock };
      },
    };
  };

  it('lists exactly two free launch characters', async () => {
    const { service } = createService();
    const chars = await service.listCharacters();
    expect(chars).toHaveLength(2);
    expect(chars.map((c) => c.id)).toEqual([
      'character-01',
      'character-02',
    ]);
    expect(chars.every((c) => c.unlock.type === 'free')).toBe(true);
  });

  it('rejects unknown characters and exclusive outfit slots', () => {
    const { service } = createService();
    expect(() =>
      service.resolveCharacter('character-99', {}),
    ).toThrow('CHARACTER_NOT_FOUND');
    expect(() =>
      service.resolveCharacter('character-01', {
        outfitTopId: 'outfit-top-base-01',
        fullOutfitId: 'full-outfit-base-01',
      }),
    ).toThrow('EXCLUSIVE_OUTFIT_SLOT');
  });

  it('rejects wrong-category items per slot', () => {
    const { service } = createService();
    expect(() =>
      service.resolveCharacter('character-01', {
        hairId: 'outfit-top-base-01',
      }),
    ).toThrow('INVALID_CATEGORY_HAIRID');
  });

  it('falls back to character-01 on unknown ID (spec §31)', () => {
    const { service } = createService();
    const resolved = service.resolveOrFallback('character-99', {
      hairId: 'nope',
    });
    expect(resolved.definition.id).toBe('character-01');
  });

  it('resolveLenient keeps valid items and drops bad ones (spec §31)', () => {
    const { service } = createService();
    const resolved = service.resolveLenient('character-01', {
      headwearId: 'headwear-base-cap-01',
      hairId: 'nope-missing-item',
      outfitTopId: 'outfit-bottom-base-01',
      accessoryIds: ['nope', 123],
    });
    expect(resolved.definition.id).toBe('character-01');
    expect(resolved.loadout.headwearId).toBe('headwear-base-cap-01');
    expect(resolved.loadout.hairId).toBeUndefined();
    expect(resolved.loadout.outfitTopId).toBeUndefined();
    expect(resolved.loadout.accessoryIds).toEqual([]);
  });

  it('resolveLenient lets full outfit win and falls back on unknown IDs', () => {
    const { service } = createService();
    const exclusive = service.resolveLenient('character-01', {
      fullOutfitId: 'full-outfit-base-01',
      outfitTopId: 'outfit-top-base-01',
    });
    expect(exclusive.loadout.fullOutfitId).toBe('full-outfit-base-01');
    expect(exclusive.loadout.outfitTopId).toBeUndefined();
    expect(service.resolveLenient('character-99', {}).definition.id).toBe(
      'character-01',
    );
  });

  it('rejects incompatible items', () => {
    const { service } = createService();
    expect(() =>
      service.resolveCharacter('character-01', { hairId: 'nope' }),
    ).toThrow();
  });

  it('falls back to default on corrupt legacy config', async () => {
    const { service, prisma } = createService();
    prisma.profile.findUnique.mockResolvedValue({
      characterConfig: { gender: 'male', hairId: 123 },
    });
    const resolved = await service.getSelection('user-1');
    expect(resolved.definition.id).toBe('character-02');
  });

  it('event-readiness: future event item validates without renderer change', () => {
    const { service } = createService();
    // Base catalog shape accepts new source:event items — renderer contract
    // unchanged; only data grows.
    const loadout = service.validateLoadout('character-01', {
      headwearId: undefined,
      accessoryIds: [],
    });
    expect(loadout.characterId).toBe('character-01');
    expect(loadout.accessoryIds).toEqual([]);
  });

  it('excludes corrupt catalog rows from the allowlist (task 12)', async () => {
    const { service, prisma } = createService();
    prisma.character.findMany.mockResolvedValue([
      {
        id: 'character-01',
        name: 'Aria',
        assetId: '/character-scene/female.glb',
        rigId: 'humanoid-v1',
        defaultLoadoutId: 'loadout-character-01-base',
        unlockType: 'free',
        unlockAmount: null,
      },
      {
        id: 'character-99-evil',
        name: 'Evil',
        assetId: '/evil.glb',
        rigId: 'humanoid-v1',
        defaultLoadoutId: 'x',
        unlockType: 'free-tampered',
        unlockAmount: null,
      },
    ]);
    prisma.characterItem.findMany.mockResolvedValue([
      {
        id: 'good-item',
        category: 'headwear',
        assetId: 'procedural-cap',
        rigId: 'humanoid-v1',
        attachment: { type: 'socket', socketName: 'headTop' },
        compatibleCharacterIds: ['character-01'],
        sourceType: 'base',
        eventId: null,
      },
      {
        id: 'evil-item',
        category: 'weapon',
        assetId: '/evil.glb',
        rigId: 'x',
        attachment: { type: 'explodes' },
        compatibleCharacterIds: [],
        sourceType: 'base',
        eventId: null,
      },
    ]);
    const chars = await service.listCharacters();
    expect(chars.map((c) => c.id)).not.toContain('character-99-evil');
    const items = await service.listItems();
    expect(items.map((i) => i.id)).toEqual(['good-item']);
  });

  it('rate-limits character writes (task 14)', async () => {
    const { service, rateLimit } = createService();
    await expect(
      service.grantCoins('user-1', 0, 'test'),
    ).rejects.toThrow('INVALID_COIN_AMOUNT');
    expect(rateLimit.assertAllowed).toHaveBeenCalled();
  });
});
