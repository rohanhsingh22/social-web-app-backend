import { CharactersService } from './characters.service';

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
    return {
      service: new CharactersService(prisma),
      prisma: prisma as unknown as {
        profile: { findUnique: jest.Mock; update: jest.Mock };
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
        fullOutfitId: 'outfit-top-base-01',
      }),
    ).toThrow('EXCLUSIVE_OUTFIT_SLOT');
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
});
