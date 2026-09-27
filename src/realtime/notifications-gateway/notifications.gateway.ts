import {
  OnGatewayConnection,
  OnGatewayDisconnect,
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
import {
  REALTIME_FANOUT_CHANNEL,
  type FanoutUserEvent,
} from '@app/realtime/fanout/fanout.service';

// Per-user push channel. Clients join `user:{id}` on connect; the API app
// publishes fanout events over Redis (separate process) which are re-emitted
// here. Currently used for connection changes; notification pushes reuse it.
@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private subscriber: Redis | null = null;

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly redis: RedisService,
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
  }

  async handleDisconnect(socket: RealtimeSocket) {
    const user = socket.data.user;

    if (!user) {
      return;
    }

    await socket.leave(`user:${user.id}`);
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

    if (
      !payload ||
      !Array.isArray(payload.userIds) ||
      (payload.event !== 'connection:changed' &&
        payload.event !== 'notification:new')
    ) {
      this.logger.debug('Ignoring unknown fanout event');
      return;
    }

    for (const userId of payload.userIds) {
      this.server.to(`user:${userId}`).emit(payload.event, {
        userIds: payload.userIds,
      });
    }
  }
}
