import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Server } from 'socket.io';
import type Redis from 'ioredis';
import { RedisService } from '@app/core/redis/redis.service';
import {
  RealtimeAuthService,
  RealtimeSocket,
} from '@app/realtime/realtime-auth/realtime-auth.service';
import { PresenceService } from '@app/realtime/presence/presence.service';
import {
  REALTIME_FANOUT_CHANNEL,
  type FanoutUserEvent,
} from '@app/realtime/fanout/fanout.service';

// Home realtime fanout (Phase 6). Clients join `user:{id}` on connect; the
// API app publishes Home mutations over Redis (separate process) which are
// re-emitted here as domain events. Socket events are notifications only —
// clients converge on the authoritative state via GET /home (spec #48-49).
// Membership transitions (accept/reject/leave/remove/destroy) converge via
// `home:state`; only new invitations and join requests carry payloads,
// because the recipient has no other way to discover them.
@WebSocketGateway({
  namespace: '/home',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class HomeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(HomeGateway.name);
  private subscriber: Redis | null = null;

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly redis: RedisService,
    private readonly presence: PresenceService,
  ) {}

  async handleConnection(socket: RealtimeSocket) {
    try {
      await this.auth.authenticate(socket);
    } catch {
      socket.emit('auth:error', {
        code: 'INVALID_ACCESS_TOKEN',
        message: 'Your session is invalid or expired.',
      });
      socket.disconnect(true);
      return;
    }

    const user = socket.data.user;

    if (!user) {
      socket.emit('auth:error', { code: 'AUTH_REQUIRED' });
      socket.disconnect(true);
      return;
    }

    await socket.join(`user:${user.id}`);
    // Presence is per-socket (spec #20 reuses this infra): without this,
    // users idling on Home never count as online and every connection reads
    // as offline. Offline still never means leaving (spec Rule 7).
    await this.presence.markOnline(user.id, socket.id);
  }

  async handleDisconnect(socket: RealtimeSocket) {
    const user = socket.data.user;

    if (!user) {
      return;
    }

    await this.presence.markOffline(user.id, socket.id);
    await socket.leave(`user:${user.id}`);
  }

  // Heartbeat from the client (~30s) keeps the 60s presence TTL alive for
  // mostly-idle Home sockets. Same pattern as the channel gateway's refresh.
  @SubscribeMessage('home:heartbeat')
  async heartbeat(@ConnectedSocket() socket: RealtimeSocket) {
    const user = socket.data.user;

    if (!user) {
      return { ok: false };
    }

    await this.presence.refreshSocket(user.id, socket.id);
    return { ok: true };
  }

  async onModuleInit() {
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
          this.dispatch(message);
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

  async onModuleDestroy() {
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

  private dispatch(raw: string) {
    let payload: FanoutUserEvent;

    try {
      payload = JSON.parse(raw) as FanoutUserEvent;
    } catch {
      this.logger.debug('Ignoring malformed fanout message');
      return;
    }

    if (!payload || !Array.isArray(payload.userIds)) {
      this.logger.debug('Ignoring unknown fanout event');
      return;
    }

    switch (payload.event) {
      case 'home:changed':
        for (const userId of payload.userIds) {
          this.server.to(`user:${userId}`).emit('home:state', {
            userIds: payload.userIds,
          });
        }
        break;
      case 'home:invitation:new':
        if (!isInvitationPayload(payload.invitation)) {
          this.logger.debug('Ignoring malformed home invitation event');
          return;
        }
        for (const userId of payload.userIds) {
          this.server.to(`user:${userId}`).emit('home:invitation:new', {
            invitation: payload.invitation,
          });
        }
        break;
      case 'home:join-request:new':
        if (!isJoinRequestPayload(payload.joinRequest)) {
          this.logger.debug('Ignoring malformed home join-request event');
          return;
        }
        for (const userId of payload.userIds) {
          this.server.to(`user:${userId}`).emit('home:join-request:new', {
            joinRequest: payload.joinRequest,
          });
        }
        break;
      default:
        this.logger.debug('Ignoring unknown fanout event');
    }
  }
}

function isInvitationPayload(
  value: unknown,
): value is Extract<
  FanoutUserEvent,
  { event: 'home:invitation:new' }
>['invitation'] {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['id'] === 'string' &&
    typeof record['homeId'] === 'string' &&
    typeof record['inviterId'] === 'string' &&
    typeof record['inviteeId'] === 'string' &&
    typeof record['expiresAt'] === 'string'
  );
}

function isJoinRequestPayload(
  value: unknown,
): value is Extract<
  FanoutUserEvent,
  { event: 'home:join-request:new' }
>['joinRequest'] {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['id'] === 'string' &&
    typeof record['homeId'] === 'string' &&
    typeof record['requesterId'] === 'string' &&
    typeof record['targetMemberId'] === 'string' &&
    typeof record['expiresAt'] === 'string'
  );
}
