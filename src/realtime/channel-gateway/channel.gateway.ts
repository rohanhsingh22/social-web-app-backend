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
import { ChannelsService } from '@app/modules/channels/channels.service';
import { PresenceService } from '@app/realtime/presence/presence.service';
import {
  RealtimeAuthService,
  RealtimeSocket,
} from '@app/realtime/realtime-auth/realtime-auth.service';
import { RealtimeRateLimitService } from '@app/realtime/realtime-rate-limit/realtime-rate-limit.service';

const CHANNEL_MESSAGE_MAX_LENGTH = 500;
const HEARTBEAT_INTERVAL_MS = 30_000;
const SWEEP_INTERVAL_MS = 60_000;

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

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly channels: ChannelsService,
    private readonly presence: PresenceService,
    private readonly rateLimit: RealtimeRateLimitService,
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
  }

  onModuleDestroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
  }

  async handleConnection(socket: RealtimeSocket) {
    try {
      await this.auth.authenticate(socket);
    } catch (error) {
      const isForbidden = error instanceof ForbiddenException;

      this.logger.warn(
        `Realtime authentication failed for socket ${socket.id}`,
        error instanceof Error ? error.stack : undefined,
      );

      socket.emit('auth:error', {
        code: isForbidden ? 'ACCOUNT_NOT_ALLOWED' : 'INVALID_ACCESS_TOKEN',
        message: isForbidden
          ? 'Your account is not allowed to connect.'
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

    const channel = await this.channels
      .getBySlugOrId(body.channelId)
      .catch((error) => {
        this.logger.error(
          `Failed to resolve channel ${body.channelId} on join`,
          error instanceof Error ? error.stack : undefined,
        );
        return null;
      });

    if (!channel) {
      return { ok: false, code: 'CHANNEL_NOT_FOUND' };
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

    const channel = await this.channels
      .getBySlugOrId(body.channelId)
      .catch((error) => {
        this.logger.error(
          `Failed to resolve channel ${body.channelId} on leave`,
          error instanceof Error ? error.stack : undefined,
        );
        return null;
      });

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

    if (user.status === 'banned') {
      socket.emit('user:banned', { code: 'USER_BANNED' });
      return { ok: false, code: 'USER_BANNED' };
    }

    if (user.status === 'muted') {
      socket.emit('user:muted', { code: 'USER_MUTED' });
      return { ok: false, code: 'USER_MUTED' };
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

    const channel = await this.channels
      .getBySlugOrId(body.channelId ?? '')
      .catch((error) => {
        this.logger.error(
          `Failed to resolve channel ${body.channelId} on message send`,
          error instanceof Error ? error.stack : undefined,
        );
        return null;
      });

    if (!channel) {
      return { ok: false, code: 'CHANNEL_NOT_FOUND' };
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

    const message = await this.channels.createMessage(
      channel.id,
      user.id,
      bodyText,
    );

    this.server.to(`channel:${channel.id}`).emit('channel:message:new', message);

    return { ok: true, message };
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
}
