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
    };
    const profile = {
      findUnique: jest.fn(),
    };
    const redisConnection = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    const prisma = {
      channel,
      channelMessage,
      profile,
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
      channel,
      channelMessage,
      profile,
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

  it('ignores non-UUID values for Toli channel lookup', async () => {
    const { service, channel } = createService();

    await expect(service.getToliChannelById('general')).resolves.toBeNull();
    expect(channel.findFirst).not.toHaveBeenCalled();
  });
});
