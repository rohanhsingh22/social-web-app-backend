import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Channel,
  ChannelType,
  MessageStatus,
  UserStatus,
} from '@prisma/client';
import { profileCardSelect, toProfileCard } from '@app/common/profile-card';
import { fetchAvatarVisibility } from '@app/common/avatar-visibility';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { RedisService } from '@app/core/redis/redis.service';
import { ModerationService } from '@app/modules/moderation/moderation.service';

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const CHANNEL_CACHE_TTL_MS = 30_000;
const MESSAGE_CACHE_TTL_SECONDS = 30;
// Generations long outlive data entries (30s): a reset generation can never
// collide with a live data key because idle channels hold no live keys.
const MESSAGE_CACHE_GENERATION_TTL_SECONDS = 86_400;

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
    publicUserId?: string;
    profile: {
      username: string;
      displayName: string;
      avatarUrl: string | null;
      profilePictureType: 'provider' | 'toli';
      toliAvatarKey: string | null;
      toli: { id: string; name: string } | null;
    } | null;
  };
};

type PublicChannelMessage = Omit<ChannelMessageWithSender, 'sender'> & {
  sender: {
    id: string;
    publicUserId?: string;
    profile: {
      username: string;
      displayName: string;
      avatarUrl: string | null;
      profileUrl: string;
      profilePicture: {
        type: string;
        avatarUrl: string | null;
        toliAvatarKey: string | null;
      };
      toli: { id: string; name: string } | null;
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

// Raw (unmapped) page: this is what Redis holds. Mapping to public profile
// cards happens on every read, never before a write — mapping twice drops
// Toli avatars (the mapped card has no `profilePictureType` scalar, so a
// second pass resolves every sender as provider with a null URL).
type RawMessagePage = {
  channel: Channel;
  messages: ChannelMessageWithSender[];
  pageInfo: MessagePageResult['pageInfo'];
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
        type: { not: ChannelType.toli },
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
        type: { not: ChannelType.toli },
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
        type: { not: ChannelType.toli },
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
        type: { not: ChannelType.toli },
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
        type: { not: ChannelType.toli },
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

  // Toli rooms are never served through the public paths above. They resolve
  // here, deliberately uncached: membership is per-user and must be checked
  // on every join/send so a Toli change takes effect immediately.
  async getToliChannelByToliId(toliId: string) {
    return this.prisma.channel.findFirst({
      where: { toliId, isActive: true },
      include: { toli: { select: { id: true, name: true } } },
    });
  }

  async getToliChannelById(id: string) {
    if (!this.isUuid(id)) {
      return null;
    }

    return this.prisma.channel.findFirst({
      where: { id, isActive: true, toliId: { not: null } },
    });
  }

  async getMyToliChannel(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { toliId: true },
    });

    if (!profile?.toliId) {
      throw new ForbiddenException('TOLI_REQUIRED');
    }

    const channel = await this.getToliChannelByToliId(profile.toliId);

    if (!channel) {
      this.logger.error(`Toli channel missing for Toli ${profile.toliId}`);
      throw new NotFoundException('TOLI_CHANNEL_NOT_FOUND');
    }

    return channel;
  }

  async hasToliChannelAccess(
    userId: string | undefined,
    channel: { toliId: string | null },
  ): Promise<boolean> {
    if (!channel.toliId) {
      return true;
    }

    if (!userId) {
      return false;
    }

    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { toliId: true },
    });

    return profile?.toliId === channel.toliId;
  }

  async warmDefaultMessageCache() {
    const channels = await this.listPublicChannels();
    const defaultChannel =
      channels.find((channel) => channel.isDefault) ?? channels[0];

    if (!defaultChannel) {
      return;
    }

    this.defaultChannelCache = this.entry(defaultChannel);
    // getMessages warms the raw message cache itself on a miss; writing the
    // mapped result here would reintroduce double-mapping corruption.
    await this.getMessages(
      defaultChannel.slug,
      undefined,
      String(DEFAULT_MESSAGE_LIMIT),
    );
  }

  async createMessage(channelId: string, senderId: string, body: string) {
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: channelId,
        isActive: true,
        visibility: 'public',
        type: { not: ChannelType.toli },
      },
    });

    if (!channel) {
      this.logger.warn(`Channel not found for id ${channelId}`);
      throw new NotFoundException('CHANNEL_NOT_FOUND');
    }

    return this.persistChannelMessage(channel.id, senderId, body);
  }

  // Gateway path for already-resolved channels (public or membership-checked
  // Toli rooms). Moderation, mapping, and cache invalidation are shared.
  async persistChannelMessage(
    channelId: string,
    senderId: string,
    body: string,
  ) {
    // Fresh status on every send: socket identity is captured at connect
    // time, so a ban/mute issued afterwards must still take effect here.
    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      select: { id: true, status: true },
    });

    if (!sender || sender.status === UserStatus.banned) {
      throw new ForbiddenException('USER_BANNED');
    }

    if (sender.status === UserStatus.muted) {
      throw new ForbiddenException('USER_MUTED');
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
              publicUserId: true,
              profile: {
                select: {
                  ...profileCardSelect,
                },
              },
            },
          },
        },
      });

      // Broadcast payload: the author's own setting applies to every
      // viewer (including the author).
      const avatars = await fetchAvatarVisibility(this.prisma, [senderId]);
      const result = this.mapMessageWithProfileUrl(message, avatars);
      // Await invalidation so an immediate GET after a send cannot hit the
      // stale Redis first-page (30s TTL) and miss the new message.
      await this.invalidateChannelMessageCache(channelId);
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
    return this.getMessagesForChannel(channel, cursor, limitValue);
  }

  async getToliMessages(
    userId: string,
    cursor?: string,
    limitValue?: string,
  ): Promise<MessagePageResult> {
    const channel = await this.getMyToliChannel(userId);
    return this.getMessagesForChannel(channel, cursor, limitValue);
  }

  private async getMessagesForChannel(
    channel: Channel,
    cursor?: string,
    limitValue?: string,
  ): Promise<MessagePageResult> {
    const limit = this.parseLimit(limitValue);

    const cached = !cursor
      ? await this.readMessageCache(channel.id, limit)
      : undefined;

    let ordered: ChannelMessageWithSender[];
    let pageInfo: MessagePageResult['pageInfo'];

    if (cached) {
      ordered = cached.messages;
      pageInfo = cached.pageInfo;
    } else {
      // Capture the generation BEFORE the DB read: if an invalidation bumps
      // it mid-flight, our write lands on the abandoned generation and can
      // never poison fresh readers (the A-miss/B-write/A-write race).
      const generation = !cursor
        ? await this.messageCacheGeneration(channel.id)
        : null;
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
                  ...profileCardSelect,
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

      pageInfo = {
        hasMore,
        nextCursor,
      };
      // Chronological for clients; kept raw here so the cache stores rows.
      ordered = page.reverse();

      if (!cursor && generation !== null) {
        void this.writeMessageCache(channel.id, limit, generation, {
          channel,
          messages: ordered,
          pageInfo,
        });
      }
    }

    // Public reads are guest-accessible (no viewer): every sender's own
    // avatar setting applies.
    const avatars = await fetchAvatarVisibility(
      this.prisma,
      ordered.map((msg) => msg.sender.id),
    );

    return {
      channel,
      messages: ordered.map((msg) =>
        this.mapMessageWithProfileUrl(msg, avatars),
      ),
      pageInfo,
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
    avatarVisibility?: Map<string, boolean>,
  ): PublicChannelMessage {
    const frontendBaseUrl = this.config.get<string>('app.frontendBaseUrl') ?? '';
    const card = toProfileCard(
      message.sender.profile,
      avatarVisibility?.get(message.sender.id) ?? true,
    );
    return {
      ...message,
      sender: {
        ...message.sender,
        profile: message.sender.profile
          ? {
              ...card,
              profileUrl: `${frontendBaseUrl}/profiles/${message.sender.profile.username}`,
            }
          : null,
      },
    };
  }

  private messageCacheGenerationKey(channelId: string) {
    return `cache:channels:${channelId}:messages:gen`;
  }

  private messageCacheKey(
    channelId: string,
    limit: number,
    generation: string,
  ) {
    // v3: generation-scoped. v1/v2 entries are orphaned and expire naturally.
    return `cache:channels:${channelId}:messages:latest:v3:g${generation}:${limit}`;
  }

  private async messageCacheGeneration(channelId: string): Promise<string> {
    try {
      return (
        (await this.redis.connection.get(
          this.messageCacheGenerationKey(channelId),
        )) ?? '0'
      );
    } catch {
      return '0';
    }
  }

  private async readMessageCache(
    channelId: string,
    limit: number,
  ): Promise<RawMessagePage | null> {
    try {
      const generation = await this.messageCacheGeneration(channelId);
      const raw = await this.redis.connection.get(
        this.messageCacheKey(channelId, limit, generation),
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
        messages: cached.messages.map((message) => ({
          ...message,
          createdAt: new Date(message.createdAt),
          deletedAt: message.deletedAt ? new Date(message.deletedAt) : null,
        })),
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
    generation: string,
    page: RawMessagePage,
  ) {
    try {
      await this.redis.connection.set(
        this.messageCacheKey(channelId, limit, generation),
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

  // Bumping the generation retires every cached first-page at once (old
  // generations orphan-expire via TTL). Atomic across API instances, and
  // cheaper than deleting one key per supported limit.
  async invalidateChannelMessageCache(channelId: string) {
    try {
      await this.redis.connection.incr(
        this.messageCacheGenerationKey(channelId),
      );
      await this.redis.connection.expire(
        this.messageCacheGenerationKey(channelId),
        MESSAGE_CACHE_GENERATION_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.debug(
        `Message cache invalidation failed for channel ${channelId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
