import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageStatus } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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
      this.logger.warn(`Channel not found for slug ${slug}`);
      throw new NotFoundException('CHANNEL_NOT_FOUND');
    }

    return channel;
  }

  async getBySlugOrId(slugOrId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: {
        isActive: true,
        visibility: 'public',
        ...(this.isUuid(slugOrId) ? { id: slugOrId } : { slug: slugOrId }),
      },
    });

    if (!channel) {
      this.logger.warn(`Channel not found for slug or id ${slugOrId}`);
      throw new NotFoundException('CHANNEL_NOT_FOUND');
    }

    return channel;
  }

  async createMessage(channelId: string, senderId: string, body: string) {
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: channelId,
        isActive: true,
        visibility: 'public',
      },
    });

    if (!channel) {
      this.logger.warn(`Channel not found for id ${channelId}`);
      throw new NotFoundException('CHANNEL_NOT_FOUND');
    }

    try {
      const message = await this.prisma.channelMessage.create({
        data: {
          channelId,
          senderId,
          body,
        },
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

      return this.mapMessageWithProfileUrl(message);
    } catch (error) {
      this.logger.error(
        `Failed to create message in channel ${channelId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
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
      messages: page.reverse().map((msg) => this.mapMessageWithProfileUrl(msg)),
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

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private mapMessageWithProfileUrl(message: {
    id: string;
    channelId: string;
    senderId: string;
    body: string;
    status: MessageStatus;
    createdAt: Date;
    deletedAt: Date | null;
    deletedBy: string | null;
    sender: {
      id: string;
      profile: {
        username: string;
        displayName: string;
        avatarUrl: string | null;
      } | null;
    };
  }) {
    const frontendBaseUrl = this.config.get<string>('app.frontendBaseUrl') ?? '';
    return {
      ...message,
      sender: {
        ...message.sender,
        profile: message.sender.profile
          ? {
              ...message.sender.profile,
              profileUrl: `${frontendBaseUrl}/profiles/${message.sender.profile.username}`,
            }
          : null,
      },
    };
  }
}
