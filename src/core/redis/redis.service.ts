import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('redis.url'), {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });

    this.client.on('error', (error) => {
      this.logger.warn(`Redis connection unavailable: ${error.message}`);
    });
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      this.logger.log('Redis connection established');
    } catch (error) {
      this.logger.warn(
        `Redis connection unavailable during startup: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  get connection(): Redis {
    return this.client;
  }

  async health(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch (error) {
      this.logger.error(
        'Redis health check failed',
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
