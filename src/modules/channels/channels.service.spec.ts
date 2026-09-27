import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelsService } from './channels.service';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { RedisService } from '@app/core/redis/redis.service';
import { ModerationService } from '@app/modules/moderation/moderation.service';

describe('ChannelsService', () => {
  const createService = () => {
    const channel = {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    };
    const channelMessage = {
      findMany: jest.fn(),
      create: jest.fn(),
    };
    const profile = {
      findUnique: jest.fn(),
    };
    const redisConnection = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };
    const user = {
      findUnique: jest.fn(),
    };
    const userSettings = { findMany: jest.fn().mockResolvedValue([]) };
    const prisma = {
      channel,
      channelMessage,
      profile,
      user,
      userSettings,
    } as unknown as PrismaService;
    const config = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    } as unknown as ConfigService;
    const redis = {
      connection: redisConnection,
    } as unknown as RedisService;
    const moderation = {
      assertMessageAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as ModerationService;

    return {
      service: new ChannelsService(prisma, config, redis, moderation),
      prisma,
      channel,
      channelMessage,
      profile,
      user,
      redisConnection,
      moderation,
    };
  };

  it('lists active public channels in stable order', async () => {
    const { service, channel } = createService();
    channel.findMany.mockResolvedValue([{ slug: 'general' }]);

    await expect(service.listPublicChannels()).resolves.toEqual([
      { slug: 'general' },
    ]);
    expect(channel.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        visibility: 'public',
        type: { not: 'toli' },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  });

  it('falls back to the first public channel when no default exists', async () => {
    const { service, channel } = createService();
    channel.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ slug: 'english' });

    await expect(service.getDefaultChannel()).resolves.toEqual({
      slug: 'english',
    });
    expect(channel.findFirst).toHaveBeenCalledTimes(2);
  });

  it('reuses channel metadata cached by the public channel list', async () => {
    const { service, channel, channelMessage } = createService();
    const cachedChannel = { id: 'channel-id', slug: 'general' };
    channel.findMany.mockResolvedValue([cachedChannel]);
    channelMessage.findMany.mockResolvedValue([]);

    await service.listPublicChannels();
    await service.getMessages('general', undefined, '50');

    expect(channel.findFirst).not.toHaveBeenCalled();
    expect(channelMessage.findMany).toHaveBeenCalledTimes(1);
  });

  it('throws when a requested channel does not exist', async () => {
    const { service, channel } = createService();
    channel.findFirst.mockResolvedValue(null);

    await expect(service.getBySlug('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns channel messages with next cursor and safe sender profile', async () => {
    const { service, channel, channelMessage } = createService();
    channel.findFirst.mockResolvedValue({
      id: 'channel-id',
      slug: 'general',
    });
    channelMessage.findMany.mockResolvedValue([
      {
        id: 'message-2',
        createdAt: new Date('2026-05-16T06:02:00.000Z'),
        sender: { id: 'user-2', profile: { username: 'two' } },
      },
      {
        id: 'message-1',
        createdAt: new Date('2026-05-16T06:01:00.000Z'),
        sender: { id: 'user-1', profile: { username: 'one' } },
      },
    ]);

    await expect(service.getMessages('general', undefined, '1')).resolves.toEqual(
      {
        channel: {
          id: 'channel-id',
          slug: 'general',
        },
        messages: [
          {
            id: 'message-2',
            createdAt: new Date('2026-05-16T06:02:00.000Z'),
            sender: {
              id: 'user-2',
              profile: {
                username: 'two',
                displayName: 'Unknown',
                avatarUrl: null,
                profileUrl: 'http://localhost:3000/profiles/two',
                profilePicture: {
                  type: 'provider',
                  avatarUrl: null,
                  toliAvatarKey: null,
                },
                toli: null,
              },
            },
          },
        ],
        pageInfo: {
          hasMore: true,
          nextCursor: '2026-05-16T06:02:00.000Z',
        },
      },
    );
    expect(channelMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        include: {
          sender: {
            select: {
              id: true,
              publicUserId: true,
              profile: {
                select: {
                  username: true,
                  displayName: true,
                  avatarUrl: true,
                  profilePictureType: true,
                  toliAvatarKey: true,
                  toli: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      }),
    );
  });

  it('returns the unified identity card on channel messages', async () => {
    const { service, channel, channelMessage } = createService();
    channel.findFirst.mockResolvedValue({
      id: 'channel-id',
      slug: 'general',
    });
    channelMessage.findMany.mockResolvedValue([
      {
        id: 'message-1',
        createdAt: new Date('2026-05-16T06:01:00.000Z'),
        sender: {
          id: 'user-1',
          publicUserId: 'HT-7K4M9Q2X',
          profile: {
            username: 'one',
            displayName: 'One',
            avatarUrl: null,
            profilePictureType: 'toli',
            toliAvatarKey: 'vector_01',
            toli: { id: 'toli-id', name: 'Vector' },
          },
        },
      },
    ]);

    await expect(service.getMessages('general', undefined, '1')).resolves.toEqual(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            sender: expect.objectContaining({
              publicUserId: 'HT-7K4M9Q2X',
              profile: expect.objectContaining({
                displayName: 'One',
                avatarUrl: null,
                profilePicture: expect.objectContaining({
                  type: 'toli',
                  toliAvatarKey: 'vector_01',
                }),
                toli: { id: 'toli-id', name: 'Vector' },
              }),
            }),
          }),
        ],
      }),
    );
  });

  it('hides avatars of senders who disabled avatar visibility', async () => {
    const { service, channel, channelMessage, prisma } = createService();
    channel.findFirst.mockResolvedValue({
      id: 'channel-id',
      slug: 'general',
    });
    channelMessage.findMany.mockResolvedValue([
      {
        id: 'message-1',
        createdAt: new Date('2026-05-16T06:01:00.000Z'),
        sender: {
          id: 'user-9',
          profile: {
            username: 'nine',
            displayName: 'Nine',
            avatarUrl: 'https://example.com/nine.png',
            profilePictureType: 'toli',
            toliAvatarKey: 'vector_01',
            toli: { id: 'toli-id', name: 'Vector' },
          },
        },
      },
    ]);
    jest.mocked(prisma.userSettings.findMany).mockResolvedValue([
      { userId: 'user-9', profileVisibility: { avatar: false } },
    ] as never);

    const result = await service.getMessages('general', undefined, '1');

    expect(result.messages[0]?.sender.profile?.avatarUrl).toBeNull();
    expect(result.messages[0]?.sender.profile?.profilePicture).toEqual({
      type: 'provider',
      avatarUrl: null,
      toliAvatarKey: null,
    });
  });

  it('rejects invalid message cursors', async () => {
    const { service, channel } = createService();
    channel.findFirst.mockResolvedValue({
      id: 'channel-id',
      slug: 'general',
    });

    await expect(service.getMessages('general', 'not-a-date')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('caches raw rows so Toli avatars survive cache reads', async () => {
    const { service, channel, channelMessage, redisConnection } =
      createService();
    channel.findFirst.mockResolvedValue({
      id: 'channel-id',
      slug: 'general',
    });
    channelMessage.findMany.mockResolvedValue([
      {
        id: 'message-1',
        createdAt: new Date('2026-05-16T06:01:00.000Z'),
        sender: {
          id: 'user-2',
          publicUserId: 'HT-7K4M9Q2X',
          profile: {
            username: 'two',
            displayName: 'Two',
            avatarUrl: 'https://provider.example/photo.png',
            profilePictureType: 'toli',
            toliAvatarKey: 'vector_01',
            toli: { id: 'toli-id', name: 'Vector' },
          },
        },
      },
    ]);

    const first = await service.getMessages('general', undefined, '50');
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0]).toEqual(
      expect.objectContaining({
        sender: expect.objectContaining({
          profile: expect.objectContaining({
            profilePicture: expect.objectContaining({
              type: 'toli',
              toliAvatarKey: 'vector_01',
            }),
          }),
        }),
      }),
    );

    // The cache must hold raw rows (scalars), not mapped cards: mapping
    // twice drops the Toli key and flips senders to provider/initial.
    expect(redisConnection.set).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(
      redisConnection.set.mock.calls[0][1] as string,
    ) as {
      messages: Array<{ sender: { profile: Record<string, unknown> } }>;
    };
    expect(stored.messages[0].sender.profile).toEqual(
      expect.objectContaining({
        profilePictureType: 'toli',
        toliAvatarKey: 'vector_01',
      }),
    );
    expect(
      stored.messages[0].sender.profile.profilePicture,
    ).toBeUndefined();

    // Second call is served from cache without DB access, with the Toli
    // avatar still intact.
    redisConnection.get.mockResolvedValue(
      redisConnection.set.mock.calls[0][1],
    );
    channelMessage.findMany.mockClear();

    const second = await service.getMessages('general', undefined, '50');
    expect(channelMessage.findMany).not.toHaveBeenCalled();
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]).toEqual(
      expect.objectContaining({
        sender: expect.objectContaining({
          profile: expect.objectContaining({
            profilePicture: expect.objectContaining({
              type: 'toli',
              toliAvatarKey: 'vector_01',
            }),
          }),
        }),
      }),
    );
  });

  it('rejects sends from banned or muted users with a fresh status check', async () => {
    const { service, user } = createService();
    user.findUnique.mockResolvedValue({ id: 'user-9', status: 'banned' });

    await expect(
      service.persistChannelMessage('channel-1', 'user-9', 'hello'),
    ).rejects.toThrow('USER_BANNED');

    user.findUnique.mockResolvedValue({ id: 'user-9', status: 'muted' });

    await expect(
      service.persistChannelMessage('channel-1', 'user-9', 'hello'),
    ).rejects.toThrow('USER_MUTED');

    expect(user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-9' },
      select: { id: true, status: true },
    });
  });

  it('requires a Toli before resolving the personal Toli room', async () => {
    const { service, profile } = createService();
    profile.findUnique.mockResolvedValue({ toliId: null });

    await expect(service.getMyToliChannel('user-1')).rejects.toThrow(
      'TOLI_REQUIRED',
    );
  });

  it('resolves the personal Toli room for members', async () => {
    const { service, channel, profile } = createService();
    profile.findUnique.mockResolvedValue({ toliId: 'vector-id' });
    channel.findFirst.mockResolvedValue({
      id: 'toli-channel-1',
      slug: 'toli-vector',
      toliId: 'vector-id',
    });

    await expect(service.getMyToliChannel('user-1')).resolves.toEqual(
      expect.objectContaining({ id: 'toli-channel-1' }),
    );
    expect(channel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { toliId: 'vector-id', isActive: true } }),
    );
  });

  it('checks Toli room access without leaking other rooms', async () => {
    const { service, profile } = createService();

    await expect(
      service.hasToliChannelAccess(undefined, { toliId: 'vector-id' }),
    ).resolves.toBe(false);
    await expect(
      service.hasToliChannelAccess('user-1', { toliId: null }),
    ).resolves.toBe(true);

    profile.findUnique.mockResolvedValue({ toliId: 'vector-id' });
    await expect(
      service.hasToliChannelAccess('user-1', { toliId: 'vector-id' }),
    ).resolves.toBe(true);

    profile.findUnique.mockResolvedValue({ toliId: 'wave-id' });
    await expect(
      service.hasToliChannelAccess('user-1', { toliId: 'vector-id' }),
    ).resolves.toBe(false);
  });

  it('never serves a stale write that lands after an invalidation', async () => {
    // Map-backed Redis double with real incr semantics.
    const store = new Map<string, string>();
    const counters = new Map<string, number>();
    const redisConnection = {
      get: jest.fn((key: string) =>
        Promise.resolve(store.has(key) ? (store.get(key) as string) : null),
      ),
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      del: jest.fn((...keys: string[]) => {
        let removed = 0;
        for (const key of keys) {
          if (store.delete(key)) {
            removed += 1;
          }
        }
        return Promise.resolve(removed);
      }),
      incr: jest.fn((key: string) => {
        // Real Redis persists the counter so later GETs observe it.
        const current = store.has(key)
          ? Number(store.get(key))
          : (counters.get(key) ?? 0);
        const next = current + 1;
        counters.set(key, next);
        store.set(key, String(next));
        return Promise.resolve(next);
      }),
      expire: jest.fn(() => Promise.resolve(1)),
    };
    const channel = { findMany: jest.fn(), findFirst: jest.fn() };
    const channelMessage = { findMany: jest.fn(), create: jest.fn() };
    const prisma = {
      channel,
      channelMessage,
      profile: { findUnique: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-2', status: 'active' }),
      },
      userSettings: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const config = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    } as unknown as ConfigService;
    const redis = { connection: redisConnection } as unknown as RedisService;
    const moderation = {
      assertMessageAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as ModerationService;
    const service = new ChannelsService(prisma, config, redis, moderation);

    const senderProfile = {
      username: 'one',
      displayName: 'One',
      avatarUrl: null,
      profilePictureType: 'provider',
      toliAvatarKey: null,
      toli: null,
    };
    const messageOne = {
      id: 'message-1',
      channelId: 'channel-id',
      senderId: 'user-1',
      body: 'hello',
      status: 'active',
      createdAt: new Date('2026-05-16T06:01:00.000Z'),
      deletedAt: null,
      deletedBy: null,
      sender: { id: 'user-1', publicUserId: 'HT-AAAA', profile: senderProfile },
    };
    const messageTwo = {
      ...messageOne,
      id: 'message-2',
      senderId: 'user-2',
      body: 'hello again',
      createdAt: new Date('2026-05-16T06:02:00.000Z'),
      sender: {
        id: 'user-2',
        publicUserId: 'HT-BBBB',
        profile: senderProfile,
      },
    };
    channel.findFirst.mockResolvedValue({ id: 'channel-id', slug: 'general' });

    // Request A misses the cache and stalls inside its DB read. The gate
    // proves A's generation was captured BEFORE B invalidates (in
    // production this ordering comes from real DB latency).
    let releaseDb!: (rows: unknown[]) => void;
    let dbStarted!: () => void;
    const dbStartedGate = new Promise<void>((resolve) => {
      dbStarted = resolve;
    });
    const slowDb = new Promise<unknown[]>((resolve) => {
      releaseDb = resolve;
    });
    channelMessage.findMany.mockImplementationOnce(() => {
      dbStarted();
      return slowDb;
    });
    const pendingFirst = service.getMessages('general', undefined, '50');
    await dbStartedGate;

    // Request B publishes a new message (bumps the cache generation).
    channelMessage.create.mockResolvedValue(messageTwo);
    channelMessage.findMany.mockImplementation((args: { take?: number }) =>
      Promise.resolve([messageTwo, messageOne].slice(0, args.take ?? 100)),
    );
    await service.createMessage('channel-id', 'user-2', 'hello again');

    // Request A's stale DB result lands AFTER the invalidation.
    releaseDb([messageOne]);
    const staleServed = await pendingFirst;
    expect(staleServed.messages.map((m) => m.id)).toEqual(['message-1']);

    // The stale write is fire-and-forget: wait until it lands, then prove
    // it went to the abandoned generation.
    for (let i = 0; i < 100 && ![...store.keys()].some((k) => k.includes(':g0:')); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const staleKeys = [...store.keys()].filter((key) => key.includes(':g0:'));
    expect(staleKeys.length).toBeGreaterThan(0);
    const fresh = await service.getMessages('general', undefined, '50');
    expect(fresh.messages.map((m) => m.id)).toEqual(['message-1', 'message-2']);
  });

  it('ignores non-UUID values for Toli channel lookup', async () => {
    const { service, channel } = createService();

    await expect(service.getToliChannelById('general')).resolves.toBeNull();
    expect(channel.findFirst).not.toHaveBeenCalled();
  });
});
