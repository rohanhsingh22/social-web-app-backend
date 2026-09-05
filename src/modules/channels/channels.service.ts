import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  listPublicChannels() {
    return this.prisma.channel.findMany({
      where: {
        isActive: true,
        visibility: 'public',
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async getDefaultChannel() {
    const defaultChannel = await this.prisma.channel.findFirst({
      where: {
        isActive: true,
        visibility: 'public',
        isDefault: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    if (defaultChannel) {
      return defaultChannel;
    }

    return this.prisma.channel.findFirst({
      where: {
        isActive: true,
        visibility: 'public',
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async getBySlug(slug: string) {
    const channel = await this.prisma.channel.findFirst({
      where: {
        slug,
        isActive: true,
        visibility: 'public',
      },
    });

    if (!channel) {
      throw new NotFoundException('CHANNEL_NOT_FOUND');
    }

    return channel;
  }

  async getMessages(slug: string, cursor?: string, limitValue?: string) {
    const channel = await this.getBySlug(slug);
    const limit = this.parseLimit(limitValue);

    const messages = await this.prisma.channelMessage.findMany({
      where: {
        channelId: channel.id,
        status: MessageStatus.active,
        ...(cursor
          ? {
              createdAt: {
                lt: this.parseCursor(cursor),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
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
    });

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore
      ? page[page.length - 1]?.createdAt.toISOString()
      : null;

    return {
      channel,
      messages: page.reverse(),
      pageInfo: {
        hasMore,
        nextCursor,
      },
    };
  }

  private parseLimit(value?: string) {
    const limit = Number(value ?? DEFAULT_MESSAGE_LIMIT);

    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException('INVALID_LIMIT');
    }

    return Math.min(limit, MAX_MESSAGE_LIMIT);
  }

  private parseCursor(cursor: string) {
    const date = new Date(cursor);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('INVALID_CURSOR');
    }

    return date;
  }
}
