import { HomeMemberRole, Prisma } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { FanoutService } from '@app/realtime/fanout/fanout.service';
import { HomePresenceService } from './home-presence.service';
import { CharactersService } from '@app/modules/characters/characters.service';
import { HomeVoiceService } from './voice/home-voice.service';
import { HomeService } from './home.service';

describe('HomeService', () => {
  const createService = () => {
    const tx = {
      home: {
        create: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      homeMembership: {
        create: jest.fn(),
      },
    };
    const prisma = {
      home: {
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      connection: {
        findMany: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
      homeMembership: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        groupBy: jest.fn(),
      },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const fanout = {
      publishUserEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as FanoutService;
    const presence = {
      presenceMap: jest.fn(),
    } as unknown as HomePresenceService;
    const voice = {
      closeVoiceHome: jest.fn().mockResolvedValue(undefined),
    } as unknown as HomeVoiceService;
    const characters = {
      resolveCharacter: jest.fn(
        (characterId: string, loadout?: Record<string, unknown>) => ({
          definition: { id: characterId },
          loadout: { characterId, accessoryIds: [], ...(loadout ?? {}) },
        }),
      ),
      resolveLenient: jest.fn(
        (characterId: string, loadout?: Record<string, unknown>) => ({
          definition: { id: characterId },
          loadout: { characterId, accessoryIds: [], ...(loadout ?? {}) },
        }),
      ),
    } as unknown as CharactersService;

    return {
      service: new HomeService(prisma, fanout, presence, voice, characters),
      prisma,
      tx,
      fanout,
      presence,
      voice,
      characters,
    };
  };

  it('reuses the existing Home when the user has membership', async () => {
    const { service, prisma } = createService();
    const home = { id: 'home-a', ownerId: 'user-1' };
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'user-1',
      home,
    });

    await expect(service.ensureHomeForUser('user-1')).resolves.toBe(home);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates a Home with an OWNER membership on first use', async () => {
    const { service, prisma, tx, fanout } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue(null);
    (tx.home.create as jest.Mock).mockResolvedValue({ id: 'home-a' });
    const created = { id: 'home-a', ownerId: 'user-1', memberships: [] };
    (tx.home.findUniqueOrThrow as jest.Mock).mockResolvedValue(created);

    await expect(service.ensureHomeForUser('user-1')).resolves.toBe(created);
    expect(tx.homeMembership.create).toHaveBeenCalledWith({
      data: { homeId: 'home-a', userId: 'user-1', role: 'OWNER' },
    });
    expect(fanout.publishUserEvent).toHaveBeenCalledWith(
      ['user-1'],
      'home:changed',
    );
  });

  it('survives concurrent creation races via P2002 retry', async () => {
    const { service, prisma, tx } = createService();
    (prisma.homeMembership.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        homeId: 'home-a',
        home: { id: 'home-a', ownerId: 'user-1' },
      });
    (tx.home.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.ensureHomeForUser('user-1')).resolves.toEqual({
      id: 'home-a',
      ownerId: 'user-1',
    });
  });

  it('returns null when the user has no Home', async () => {
    const { service, prisma } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getHomeForUser('user-1')).resolves.toBeNull();
  });

  it('destroys only via the owner and notifies all members', async () => {
    const { service, prisma, fanout } = createService();
    (prisma.home.findUnique as jest.Mock).mockResolvedValue({
      id: 'home-a',
      memberships: [
        { userId: 'owner-1', role: HomeMemberRole.OWNER },
        { userId: 'user-2', role: HomeMemberRole.PARTICIPANT },
      ],
    });

    await expect(service.destroyHome('home-a', 'owner-1')).resolves.toEqual({
      homeId: 'home-a',
      removedUserIds: ['owner-1', 'user-2'],
    });
    expect(prisma.home.delete).toHaveBeenCalledWith({
      where: { id: 'home-a' },
    });
    expect(fanout.publishUserEvent).toHaveBeenCalledWith(
      ['owner-1', 'user-2'],
      'home:changed',
    );
  });

  it('closes the voice room on destroy, fail-open on SFU outage', async () => {
    const { service, prisma, voice } = createService();
    (prisma.home.findUnique as jest.Mock).mockResolvedValue({
      id: 'home-a',
      memberships: [
        { userId: 'owner-1', role: HomeMemberRole.OWNER },
      ],
    });
    (voice.closeVoiceHome as jest.Mock).mockResolvedValue(undefined);

    await expect(service.destroyHome('home-a', 'owner-1')).resolves.toEqual({
      homeId: 'home-a',
      removedUserIds: ['owner-1'],
    });
    expect(voice.closeVoiceHome).toHaveBeenCalledWith('home-a');

    (voice.closeVoiceHome as jest.Mock).mockRejectedValue(
      new Error('sfu down'),
    );
    await expect(service.destroyHome('home-a', 'owner-1')).resolves.toEqual(
      expect.objectContaining({ homeId: 'home-a' }),
    );
  });

  it('rejects destroy by participants and strangers', async () => {
    const { service, prisma } = createService();
    (prisma.home.findUnique as jest.Mock).mockResolvedValue({
      id: 'home-a',
      memberships: [
        { userId: 'owner-1', role: HomeMemberRole.OWNER },
        { userId: 'user-2', role: HomeMemberRole.PARTICIPANT },
      ],
    });

    await expect(service.destroyHome('home-a', 'user-2')).rejects.toThrow(
      'NOT_HOME_OWNER',
    );
    await expect(service.destroyHome('home-a', 'stranger')).rejects.toThrow(
      'NOT_HOME_MEMBER',
    );
    expect(prisma.home.delete).not.toHaveBeenCalled();
  });

  it('throws HOME_NOT_FOUND for unknown Homes', async () => {
    const { service, prisma } = createService();
    (prisma.home.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.destroyHome('missing', 'user-1')).rejects.toThrow(
      'HOME_NOT_FOUND',
    );
  });

  it('returns null Home state when homeless', async () => {
    const { service, prisma } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getHomeState('user-1')).resolves.toBeNull();
  });

  it('returns render-ready Home state in one call', async () => {
    const { service, prisma, presence } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      home: {
        id: 'home-a',
        ownerId: 'owner-1',
        memberships: [
          {
            userId: 'owner-1',
            role: HomeMemberRole.OWNER,
            joinedAt: new Date('2026-10-05T00:00:00.000Z'),
          },
          {
            userId: 'user-2',
            role: HomeMemberRole.PARTICIPANT,
            joinedAt: new Date('2026-10-05T00:01:00.000Z'),
          },
        ],
      },
    });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'owner-1',
        publicUserId: 'HT-OWNER001',
        profile: {
          displayName: 'Owner',
          characterConfig: { gender: 'female' },
        },
      },
      {
        id: 'user-2',
        publicUserId: 'HT-USER0002',
        profile: {
          displayName: 'Guest',
          characterConfig: { gender: 'male' },
        },
      },
    ]);
    (presence.presenceMap as jest.Mock).mockResolvedValue(
      new Map([
        ['owner-1', 'online'],
        ['user-2', 'offline'],
      ]),
    );
    (prisma.connection.findMany as jest.Mock).mockResolvedValue([]);

    const state = await service.getHomeState('owner-1');

    expect(state).toEqual({
      id: 'home-a',
      ownerId: 'owner-1',
      memberCount: 2,
      members: [
        {
          userId: 'owner-1',
          publicUserId: 'HT-OWNER001',
          displayName: 'Owner',
          role: HomeMemberRole.OWNER,
          isOwner: true,
          isSelf: true,
          connectionStatus: 'self',
          presence: 'online',
          characterConfig: { gender: 'female' },
          character: null,
          joinedAt: new Date('2026-10-05T00:00:00.000Z'),
        },
        {
          userId: 'user-2',
          publicUserId: 'HT-USER0002',
          displayName: 'Guest',
          role: HomeMemberRole.PARTICIPANT,
          isOwner: false,
          isSelf: false,
          connectionStatus: 'none',
          presence: 'offline',
          characterConfig: { gender: 'male' },
          character: null,
          joinedAt: new Date('2026-10-05T00:01:00.000Z'),
        },
      ],
    });
  });

  it('classifies connections as AVAILABLE, MY_HOME, or OTHER_HOME', async () => {
    const { service, prisma, presence } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'viewer-1',
    });
    (prisma.connection.findMany as jest.Mock).mockResolvedValue([
      { requesterId: 'viewer-1', receiverId: 'free-1' },
      { requesterId: 'mate-1', receiverId: 'viewer-1' },
      { requesterId: 'viewer-1', receiverId: 'busy-1' },
    ]);
    (prisma.user.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'free-1',
        publicUserId: 'HT-FREE0001',
        profile: { displayName: 'Free', characterConfig: null },
      },
      {
        id: 'mate-1',
        publicUserId: 'HT-MATE0001',
        profile: { displayName: 'Mate', characterConfig: null },
      },
      {
        id: 'busy-1',
        publicUserId: 'HT-BUSY0001',
        profile: { displayName: 'Busy', characterConfig: null },
      },
    ]);
    (prisma.homeMembership.findMany as jest.Mock).mockResolvedValue([
      { userId: 'mate-1', homeId: 'home-a' },
      { userId: 'busy-1', homeId: 'home-b' },
    ]);
    (prisma.homeMembership.groupBy as jest.Mock).mockResolvedValue([
      { homeId: 'home-a', _count: { homeId: 2 } },
      { homeId: 'home-b', _count: { homeId: 3 } },
    ]);
    (presence.presenceMap as jest.Mock).mockResolvedValue(
      new Map([
        ['free-1', 'online'],
        ['mate-1', 'online'],
        ['busy-1', 'offline'],
      ]),
    );

    const connections = await service.getHomeConnections('viewer-1');

    expect(connections).toEqual([
      expect.objectContaining({
        userId: 'free-1',
        presence: 'online',
        homeState: 'AVAILABLE',
        homeMemberCount: null,
      }),
      expect.objectContaining({
        userId: 'mate-1',
        homeState: 'MY_HOME',
        homeMemberCount: null,
      }),
      expect.objectContaining({
        userId: 'busy-1',
        presence: 'offline',
        homeState: 'OTHER_HOME',
        homeMemberCount: 3,
      }),
    ]);
  });

  it('returns an empty connection list without connections', async () => {
    const { service, prisma } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.connection.findMany as jest.Mock).mockResolvedValue([]);

    await expect(service.getHomeConnections('user-1')).resolves.toEqual([]);
  });
});
