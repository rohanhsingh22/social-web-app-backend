import {
  ForbiddenException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import type Redis from 'ioredis';
import { ChannelsService } from '@app/modules/channels/channels.service';
import { RedisService } from '@app/core/redis/redis.service';
import { PresenceService } from '@app/realtime/presence/presence.service';
import {
  REALTIME_FANOUT_CHANNEL,
  type FanoutUserEvent,
} from '@app/realtime/fanout/fanout.service';
import {
  RealtimeAuthService,
  RealtimeSocket,
} from '@app/realtime/realtime-auth/realtime-auth.service';
import { RealtimeRateLimitService } from '@app/realtime/realtime-rate-limit/realtime-rate-limit.service';

const CHANNEL_MESSAGE_MAX_LENGTH = 500;
const HEARTBEAT_INTERVAL_MS = 30_000;
const SWEEP_INTERVAL_MS = 60_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

type JoinPayload = { channelId?: string };
type SendPayload = { channelId?: string; body?: string };

@WebSocketGateway({
  namespace: '/channels',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChannelGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChannelGateway.name);
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private subscriber: Redis | null = null;

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly channels: ChannelsService,
    private readonly presence: PresenceService,
    private readonly rateLimit: RealtimeRateLimitService,
    private readonly redis: RedisService,
  ) {}

  afterInit() {
    this.heartbeatTimer = setInterval(
      () => void this.refreshPresence(),
      HEARTBEAT_INTERVAL_MS,
    );
    this.sweepTimer = setInterval(
      () => void this.sweepStalePresence(),
      SWEEP_INTERVAL_MS,
    );
    void this.subscribeFanout();
  }

  onModuleDestroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }

    void this.unsubscribeFanout();
  }

  async handleConnection(socket: RealtimeSocket) {
    try {
      await this.auth.authenticate(socket);
    } catch (error) {
      const isForbidden = error instanceof ForbiddenException;
      const message =
        error instanceof Error ? error.message : 'Authentication failed';

      this.logger.warn(
        `Realtime authentication failed for socket ${socket.id}`,
        error instanceof Error ? error.stack : undefined,
      );

      socket.emit('auth:error', {
        code: isForbidden
          ? 'ACCOUNT_NOT_ALLOWED'
          : message === 'SESSION_EXPIRED'
            ? 'SESSION_EXPIRED'
            : 'INVALID_ACCESS_TOKEN',
        message: isForbidden
          ? 'Your account is not allowed to connect.'
          : message === 'SESSION_EXPIRED'
            ? 'Your session has expired. Please refresh your token.'
            : 'Your session is invalid or expired.',
      });

      socket.disconnect(true);
      return;
    }

    const user = socket.data.user;

    if (user) {
      await this.presence.markOnline(user.id, socket.id);
    }
  }

  async handleDisconnect(socket: RealtimeSocket) {
    const user = socket.data.user;

    if (!user) {
      return;
    }

    await this.presence.markOffline(user.id, socket.id);

    for (const channelId of socket.data.joinedChannelIds) {
      await this.presence.leaveChannel(channelId, user.id);
      await this.broadcastPresence(channelId);
    }
  }

  @SubscribeMessage('channel:join')
  async joinChannel(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: JoinPayload,
  ) {
    if (!body.channelId) {
      return { ok: false, code: 'CHANNEL_REQUIRED' };
    }

    const channel = await this.resolveChannel(body.channelId);

    if (!channel) {
      return { ok: false, code: 'CHANNEL_NOT_FOUND' };
    }

    if (channel.toliId) {
      const user = socket.data.user;

      if (!user) {
        return { ok: false, code: 'AUTH_REQUIRED' };
      }

      const allowed = await this.channels.hasToliChannelAccess(
        user.id,
        channel,
      );

      if (!allowed) {
        return { ok: false, code: 'TOLI_FORBIDDEN' };
      }
    }

    await socket.join(`channel:${channel.id}`);
    const alreadyJoined = socket.data.joinedChannelIds.has(channel.id);
    socket.data.joinedChannelIds.add(channel.id);

    const user = socket.data.user;

    if (user && !alreadyJoined) {
      await this.presence.joinChannel(channel.id, user.id);
      await this.broadcastPresence(channel.id);
    }

    return { ok: true, channelId: channel.id };
  }

  @SubscribeMessage('channel:leave')
  async leaveChannel(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: JoinPayload,
  ) {
    if (!body.channelId) {
      return { ok: true };
    }

    const channel = await this.resolveChannel(body.channelId);

    if (!channel) {
      return { ok: true };
    }

    await socket.leave(`channel:${channel.id}`);
    const wasJoined = socket.data.joinedChannelIds.has(channel.id);
    socket.data.joinedChannelIds.delete(channel.id);

    const user = socket.data.user;

    if (user && wasJoined) {
      await this.presence.leaveChannel(channel.id, user.id);
      await this.broadcastPresence(channel.id);
    }

    return { ok: true };
  }

  @SubscribeMessage('channel:message:send')
  async sendChannelMessage(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: SendPayload,
  ) {
    const user = socket.data.user;

    if (!user) {
      return { ok: false, code: 'AUTH_REQUIRED' };
    }

    const bodyText = body.body?.trim();

    if (!bodyText) {
      return { ok: false, code: 'MESSAGE_REQUIRED' };
    }

    if (bodyText.length > CHANNEL_MESSAGE_MAX_LENGTH) {
      socket.emit('channel:error', {
        code: 'MESSAGE_TOO_LONG',
        message: `Messages must be ${CHANNEL_MESSAGE_MAX_LENGTH} characters or fewer.`,
      });
      return { ok: false, code: 'MESSAGE_TOO_LONG' };
    }

    const channel = await this.resolveChannel(body.channelId ?? '');

    if (!channel) {
      return { ok: false, code: 'CHANNEL_NOT_FOUND' };
    }

    // Membership is re-checked on every send so a Toli change takes effect
    // immediately, even on long-lived sockets. Stale-room reads after a
    // change are additionally cut off by the client leaving on Toli change
    // (a Redis-backed kick is the Phase 10 hardening follow-up).
    const allowed = await this.channels.hasToliChannelAccess(
      user.id,
      channel,
    );

    if (!allowed) {
      socket.emit('channel:error', {
        code: 'TOLI_FORBIDDEN',
        message: 'This chat room belongs to another Toli.',
      });
      return { ok: false, code: 'TOLI_FORBIDDEN' };
    }

    const rateLimitResult = await this.rateLimit.checkChannelMessage(
      user.id,
      channel.id,
    );

    if (!rateLimitResult.allowed) {
      socket.emit('channel:error', {
        code: 'RATE_LIMITED',
        retryAfterMs: rateLimitResult.retryAfterMs,
        message: 'You are sending messages too quickly.',
      });
      return { ok: false, code: 'RATE_LIMITED' };
    }

    // Banned/muted status is enforced fresh inside persistChannelMessage:
    // socket identity is captured at connect time and would otherwise go
    // stale after a moderation action.
    try {
      const message = await this.channels.persistChannelMessage(
        channel.id,
        user.id,
        bodyText,
      );

      this.server
        .to(`channel:${channel.id}`)
        .emit('channel:message:new', message);

      return { ok: true, message };
    } catch (error) {
      if (error instanceof ForbiddenException) {
        if (error.message === 'USER_BANNED') {
          socket.emit('user:banned', { code: 'USER_BANNED' });
          return { ok: false, code: 'USER_BANNED' };
        }

        if (error.message === 'USER_MUTED') {
          socket.emit('user:muted', { code: 'USER_MUTED' });
          return { ok: false, code: 'USER_MUTED' };
        }
      }

      throw error;
    }
  }

  private async resolveChannel(channelId: string) {
    // UUIDs are looked up as Toli rooms first: the public lookup throws
    // CHANNEL_NOT_FOUND for them, which previously logged a scary ERROR +
    // stack on every Toli join/send/leave even though the fallback succeeded.
    // Slugs keep the public-first order. A miss on both sides is the only
    // case worth logging, once and without a stack trace.
    const lookups = isUuid(channelId)
      ? [
          () => this.channels.getToliChannelById(channelId),
          () => this.channels.getBySlugOrId(channelId),
        ]
      : [
          () => this.channels.getBySlugOrId(channelId),
          () => this.channels.getToliChannelById(channelId),
        ];

    for (const lookup of lookups) {
      const channel = await lookup().catch(() => null);
      if (channel) {
        return channel;
      }
    }

    this.logger.warn(
      `Could not resolve channel ${channelId} as a public or Toli room`,
    );
    return null;
  }

  private async refreshPresence(): Promise<void> {
    try {
      const sockets = await this.server.fetchSockets();

      await Promise.all(
        sockets.map((socket) => {
          const data = socket.data as {
            user?: RealtimeSocket['data']['user'];
            joinedChannelIds: Set<string>;
          };
          const user = data.user;

          if (!user) {
            return Promise.resolve();
          }

          return Promise.all([
            this.presence.refreshSocket(user.id, socket.id),
            ...Array.from(data.joinedChannelIds).map((channelId) =>
              this.presence.refreshChannel(channelId, user.id),
            ),
          ]);
        }),
      );
    } catch (error) {
      this.logger.error(
        'Presence refresh failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async sweepStalePresence(): Promise<void> {
    try {
      await this.presence.sweepStale();
    } catch (error) {
      this.logger.error(
        'Stale presence cleanup failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async broadcastPresence(channelId: string): Promise<void> {
    const online = await this.presence.onlineCount(channelId);
    this.server
      .to(`channel:${channelId}`)
      .emit('channel:presence:update', { channelId, online });
  }

  private async subscribeFanout(): Promise<void> {
    try {
      // A dedicated duplicate: a subscriber-mode connection cannot run
      // commands, so the shared client must never subscribe.
      const subscriber = this.redis.connection.duplicate();
      if (subscriber.status !== 'ready') {
        await subscriber.connect();
      }
      await subscriber.subscribe(REALTIME_FANOUT_CHANNEL);
      subscriber.on('message', (channel, message) => {
        if (channel === REALTIME_FANOUT_CHANNEL) {
          void this.dispatchFanout(message);
        }
      });
      subscriber.on('error', (error: Error) => {
        this.logger.warn(`Fanout subscriber error: ${error.message}`);
      });
      this.subscriber = subscriber;
      this.logger.log('Fanout subscriber established');
    } catch (error) {
      this.logger.warn(
        `Fanout subscriber unavailable: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async unsubscribeFanout(): Promise<void> {
    if (!this.subscriber) {
      return;
    }

    try {
      await this.subscriber.unsubscribe(REALTIME_FANOUT_CHANNEL);
      await this.subscriber.quit();
    } catch (error) {
      this.logger.debug(
        `Fanout subscriber teardown failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    } finally {
      this.subscriber = null;
    }
  }

  private async dispatchFanout(raw: string): Promise<void> {
    let payload: FanoutUserEvent;

    try {
      payload = JSON.parse(raw) as FanoutUserEvent;
    } catch {
      return;
    }

    if (!payload || payload.event !== 'toli:changed') {
      return;
    }

    for (const userId of payload.userIds ?? []) {
      await this.evictStaleToliRooms(userId);
    }
  }

  // A Toli change must cut off reads immediately, not just future sends:
  // walk every local socket of the user and leave rooms they can no longer
  // access (covers all tabs/devices via fetchSockets).
  private async evictStaleToliRooms(userId: string): Promise<void> {
    let sockets: Awaited<ReturnType<Server['fetchSockets']>>;

    try {
      sockets = await this.server.fetchSockets();
    } catch (error) {
      this.logger.debug(
        `Toli eviction socket scan failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return;
    }

    for (const socket of sockets) {
      // socket.data survives as plain JSON across instances (custom Sets do
      // not), but adapter rooms transmit explicitly — use rooms for the room
      // list and data only for the user identity.
      const data = socket.data as Partial<RealtimeSocket['data']> | undefined;
      const socketUserId =
        typeof data?.user === 'object' && data.user !== null
          ? (data.user as { id?: unknown }).id
          : undefined;

      if (socketUserId !== userId) {
        continue;
      }

      const rooms: unknown = (socket as { rooms?: unknown }).rooms;
      const roomNames: string[] = rooms instanceof Set
        ? [...rooms].filter((room): room is string => typeof room === 'string')
        : Array.isArray(rooms)
          ? rooms.filter((room): room is string => typeof room === 'string')
          : [];
      const channelIds = roomNames
        .filter((room) => room.startsWith('channel:'))
        .map((room) => room.slice('channel:'.length));

      for (const channelId of channelIds) {
        let allowed = true;

        try {
          const channel = await this.resolveChannel(channelId);
          allowed =
            !!channel &&
            (await this.channels.hasToliChannelAccess(userId, channel));
        } catch {
          allowed = false;
        }

        if (allowed) {
          continue;
        }

        try {
          await socket.leave(`channel:${channelId}`);
        } catch {
          // Best effort: the access check above already blocks reads/sends.
        }
        // Local tracking is a real Set; remote copies are fixed up when the
        // kicked client leaves back (see the frontend kick handler).
        if (data?.joinedChannelIds instanceof Set) {
          data.joinedChannelIds.delete(channelId);
        }
        await this.presence.leaveChannel(channelId, userId);
        await this.broadcastPresence(channelId);
        socket.emit('channel:kicked', {
          channelId,
          code: 'TOLI_FORBIDDEN',
        });
      }
    }
  }
}
