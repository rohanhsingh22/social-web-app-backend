import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@app/core/redis/redis.service';

const PRESENCE_TTL_SECONDS = 60;
const SWEEP_SCAN_BATCH = 100;

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(private readonly redis: RedisService) {}

  async markOnline(userId: string, socketId: string): Promise<void> {
    await this.refreshSocket(userId, socketId);
  }

  async markOffline(userId: string, socketId: string): Promise<void> {
    await this.redis.connection.zrem(this.userKey(userId), socketId);
  }

  async refreshSocket(userId: string, socketId: string): Promise<void> {
    const client = this.redis.connection;
    const now = Date.now();

    await client.zadd(this.userKey(userId), now, socketId);
    await client.expire(this.userKey(userId), PRESENCE_TTL_SECONDS);
  }

  async joinChannel(channelId: string, userId: string): Promise<void> {
    await this.refreshChannel(channelId, userId);
  }

  async leaveChannel(channelId: string, userId: string): Promise<void> {
    await this.redis.connection.zrem(this.channelKey(channelId), userId);
  }

  async refreshChannel(channelId: string, userId: string): Promise<void> {
    const client = this.redis.connection;
    const now = Date.now();

    await client.zadd(this.channelKey(channelId), now, userId);
    await client.expire(this.channelKey(channelId), PRESENCE_TTL_SECONDS);
  }

  async onlineCount(channelId: string): Promise<number> {
    return this.redis.connection.zcount(
      this.channelKey(channelId),
      this.cutoffScore(),
      '+inf',
    );
  }

  async isUserOnline(userId: string): Promise<boolean> {
    const count = await this.redis.connection.zcount(
      this.userKey(userId),
      this.cutoffScore(),
      '+inf',
    );

    return count > 0;
  }

  async sweepStale(): Promise<void> {
    const client = this.redis.connection;
    const cutoff = this.cutoffScore();
    let cursor = '0';

    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        'MATCH',
        'presence:*',
        'COUNT',
        SWEEP_SCAN_BATCH,
      );

      cursor = nextCursor;

      await Promise.all(
        keys.map((key) => client.zremrangebyscore(key, '-inf', cutoff)),
      );
    } while (cursor !== '0');
  }

  private cutoffScore(): number {
    return Date.now() - PRESENCE_TTL_SECONDS * 1000;
  }

  private userKey(userId: string): string {
    return `presence:user:${userId}`;
  }

  private channelKey(channelId: string): string {
    return `presence:channel:${channelId}`;
  }
}
