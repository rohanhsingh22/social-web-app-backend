import { Injectable } from '@nestjs/common';
import { RedisService } from '@app/core/redis/redis.service';

@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}

  async markUserOnline(userId: string, socketId: string) {
    await this.redis.connection.sadd(`socket:user:${userId}`, socketId);
    await this.redis.connection.set(`presence:user:${userId}`, 'online', 'EX', 60);
  }
}
