import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private pubClient: Redis;
  private subClient: Redis;
  private connected = false;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(url: string): Promise<void> {
    this.pubClient = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    this.subClient = this.pubClient.duplicate();

    this.pubClient.on('error', (error) => {
      this.logger.warn(`Redis adapter pub client error: ${error.message}`);
    });
    this.subClient.on('error', (error) => {
      this.logger.warn(`Redis adapter sub client error: ${error.message}`);
    });

    try {
      await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
      this.connected = true;
      this.logger.log('Redis Socket.IO adapter connected');
    } catch (error) {
      this.connected = false;
      this.logger.warn(
        `Redis Socket.IO adapter unavailable; continuing without cross-instance pub/sub: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);

    if (this.connected && this.pubClient && this.subClient) {
      server.adapter(createAdapter(this.pubClient, this.subClient));
    }

    return server;
  }
}
