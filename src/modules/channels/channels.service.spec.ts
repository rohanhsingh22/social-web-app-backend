import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { PrismaService } from '@app/core/prisma/prisma.service';

describe('ChannelsService', () => {
  const createService = () => {
    const channel = {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    };
    const channelMessage = {
      findMany: jest.fn(),
    };
    const prisma = {
      channel,
      channelMessage,
    } as unknown as PrismaService;

    return {
      service: new ChannelsService(prisma),
      channel,
      channelMessage,
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
            sender: { id: 'user-2', profile: { username: 'two' } },
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
              profile: {
                select: {
                  username: true,
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
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
});
