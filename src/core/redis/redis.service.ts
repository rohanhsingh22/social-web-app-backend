import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
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

  get connection(): Redis {
    return this.client;
  }

  async health(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
