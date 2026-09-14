import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, MessageStatus } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { RedisService } from '@app/core/redis/redis.service';
import { ModerationService } from '@app/modules/moderation/moderation.service';

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const CHANNEL_CACHE_TTL_MS = 30_000;
const MESSAGE_CACHE_TTL_SECONDS = 30;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type ChannelMessageWithSender = {
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
};

type PublicChannelMessage = Omit<ChannelMessageWithSender, 'sender'> & {
  sender: {
    id: string;
    profile: {
      username: string;
      displayName: string;
      avatarUrl: string | null;
      profileUrl: string;
    } | null;
  };
};

type MessagePageResult = {
  channel: Channel;
  messages: PublicChannelMessage[];
  pageInfo: {
    hasMore: boolean;
    nextCursor: string | null;
  };
};

type CachedChannel = Omit<Channel, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

type CachedChannelMessage = Omit<
  ChannelMessageWithSender,
  'createdAt' | 'deletedAt'
> & {
  createdAt: string;
  deletedAt: string | null;
};

type CachedMessagePage = {
  channel: CachedChannel;
  messages: CachedChannelMessage[];
  pageInfo: MessagePageResult['pageInfo'];
};

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);
  private publicChannelsCache?: CacheEntry<Channel[]>;
  private defaultChannelCache?: CacheEntry<Channel | null>;
  private readonly channelCache = new Map<string, CacheEntry<Channel>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly moderation: ModerationService,
  ) {}

  async listPublicChannels() {
    const cached = this.getFresh(this.publicChannelsCache);

    if (cached) {
      return cached;
    }

    const channels = await this.prisma.channel.findMany({
      where: {
        isActive: true,
        visibility: 'public',
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    this.publicChannelsCache = this.entry(channels);
    for (const channel of channels) {
      this.cacheChannel(channel);
    }

    return channels;
  }

  async getDefaultChannel() {
    const cached = this.getFresh(this.defaultChannelCache);

    if (cached !== undefined) {
      return cached;
    }

    const defaultChannel = await this.prisma.channel.findFirst({
      where: {
        isActive: true,
        visibility: 'public',
        isDefault: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    if (defaultChannel) {
      this.defaultChannelCache = this.entry(defaultChannel);
      this.cacheChannel(defaultChannel);
      return defaultChannel;
    }

    const firstChannel = await this.prisma.channel.findFirst({
      where: {
        isActive: true,
        visibility: 'public',
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    this.defaultChannelCache = this.entry(firstChannel);
    if (firstChannel) {
      this.cacheChannel(firstChannel);
    }

    return firstChannel;
  }

  async getBySlug(slug: string) {
    const cached = this.getFresh(this.channelCache.get(this.slugKey(slug)));

    if (cached) {
      return cached;
    }

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

    this.cacheChannel(channel);
    return channel;
  }

  async getBySlugOrId(slugOrId: string) {
    const cacheKey = this.isUuid(slugOrId)
      ? this.idKey(slugOrId)
      : this.slugKey(slugOrId);
    const cached = this.getFresh(this.channelCache.get(cacheKey));

    if (cached) {
      return cached;
    }

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

    this.cacheChannel(channel);
    return channel;
  }

  invalidatePublicChannelCache() {
    this.publicChannelsCache = undefined;
    this.defaultChannelCache = undefined;
    this.channelCache.clear();
  }

  async warmDefaultMessageCache() {
    const channels = await this.listPublicChannels();
    const defaultChannel =
      channels.find((channel) => channel.isDefault) ?? channels[0];

    if (!defaultChannel) {
      return;
    }

    this.defaultChannelCache = this.entry(defaultChannel);
    const page = await this.getMessages(
      defaultChannel.slug,
      undefined,
      String(DEFAULT_MESSAGE_LIMIT),
    );
    await this.writeMessageCache(defaultChannel.id, DEFAULT_MESSAGE_LIMIT, page);
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

    await this.moderation.assertMessageAllowed(body);

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

      const result = this.mapMessageWithProfileUrl(message);
      void this.invalidateMessageCache(channelId);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to create message in channel ${channelId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async getMessages(
    slug: string,
    cursor?: string,
    limitValue?: string,
  ): Promise<MessagePageResult> {
    const channel = await this.getBySlug(slug);
    const limit = this.parseLimit(limitValue);

    if (!cursor) {
      const cached = await this.readMessageCache(channel.id, limit);
      if (cached) {
        return cached;
      }
    }

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
            publicUserId: true,
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

    const result = {
      channel,
      messages: page.reverse().map((msg) => this.mapMessageWithProfileUrl(msg)),
      pageInfo: {
        hasMore,
        nextCursor,
      },
    };

    if (!cursor) {
      void this.writeMessageCache(channel.id, limit, result);
    }

    return result;
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

  private cacheChannel(channel: Channel) {
    const entry = this.entry(channel);
    this.channelCache.set(this.idKey(channel.id), entry);
    this.channelCache.set(this.slugKey(channel.slug), entry);
  }

  private idKey(id: string) {
    return `id:${id}`;
  }

  private slugKey(slug: string) {
    return `slug:${slug}`;
  }

  private entry<T>(value: T): CacheEntry<T> {
    return {
      value,
      expiresAt: Date.now() + CHANNEL_CACHE_TTL_MS,
    };
  }

  private getFresh<T>(entry?: CacheEntry<T>): T | undefined {
    if (!entry || entry.expiresAt <= Date.now()) {
      return undefined;
    }

    return entry.value;
  }

  private mapMessageWithProfileUrl(
    message: ChannelMessageWithSender,
  ): PublicChannelMessage {
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

  private messageCacheKey(channelId: string, limit: number) {
    return `cache:channels:${channelId}:messages:latest:${limit}`;
  }

  private async readMessageCache(
    channelId: string,
    limit: number,
  ): Promise<MessagePageResult | null> {
    try {
      const raw = await this.redis.connection.get(
        this.messageCacheKey(channelId, limit),
      );

      if (!raw) {
        return null;
      }

      const cached = JSON.parse(raw) as CachedMessagePage;

      return {
        channel: {
          ...cached.channel,
          createdAt: new Date(cached.channel.createdAt),
          updatedAt: new Date(cached.channel.updatedAt),
        },
        messages: cached.messages.map((message) =>
          this.mapMessageWithProfileUrl({
            ...message,
            createdAt: new Date(message.createdAt),
            deletedAt: message.deletedAt ? new Date(message.deletedAt) : null,
          }),
        ),
        pageInfo: cached.pageInfo,
      };
    } catch (error) {
      this.logger.debug(
        `Message cache read failed for channel ${channelId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  private async writeMessageCache(
    channelId: string,
    limit: number,
    page: MessagePageResult,
  ) {
    try {
      await this.redis.connection.set(
        this.messageCacheKey(channelId, limit),
        JSON.stringify(page),
        'EX',
        MESSAGE_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.debug(
        `Message cache write failed for channel ${channelId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async invalidateMessageCache(channelId: string) {
    try {
      const keys = Array.from({ length: MAX_MESSAGE_LIMIT }, (_, index) =>
        this.messageCacheKey(channelId, index + 1),
      );
      await this.redis.connection.del(...keys);
    } catch (error) {
      this.logger.debug(
        `Message cache invalidation failed for channel ${channelId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
