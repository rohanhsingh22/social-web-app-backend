import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@app/core/redis/redis.service';

type RateLimitWindow = {
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

const CHANNEL_WINDOWS: RateLimitWindow[] = [
  { limit: 3, windowSeconds: 2 },
  { limit: 10, windowSeconds: 10 },
];

const PER_CHANNEL_WINDOWS: RateLimitWindow[] = [
  { limit: 30, windowSeconds: 1 },
];

@Injectable()
export class RealtimeRateLimitService {
  private readonly logger = new Logger(RealtimeRateLimitService.name);

  constructor(private readonly redis: RedisService) {}

  async checkChannelMessage(
    userId: string,
    channelId: string,
  ): Promise<RateLimitResult> {
    const userLimit = await this.checkWindows(
      `ratelimit:channel:user:${userId}`,
      CHANNEL_WINDOWS,
    );

    if (!userLimit.allowed) {
      return userLimit;
    }

    return this.checkWindows(
      `ratelimit:channel:global:${channelId}`,
      PER_CHANNEL_WINDOWS,
    );
  }

  private async checkWindows(
    baseKey: string,
    windows: RateLimitWindow[],
  ): Promise<RateLimitResult> {
    for (const window of windows) {
      const key = `${baseKey}:${window.windowSeconds}`;
      const results = await this.redis.connection
        .multi()
        .incr(key)
        .expire(key, window.windowSeconds, 'NX')
        .ttl(key)
        .exec();

      const [[incrError, countResult], , [ttlError, ttlResult]] =
        results ?? [];

      if (incrError) {
        this.logger.error(
          `Rate limit incr failed for ${key}`,
          incrError instanceof Error ? incrError.stack : undefined,
        );
        throw incrError;
      }

      if (ttlError) {
        this.logger.error(
          `Rate limit ttl failed for ${key}`,
          ttlError instanceof Error ? ttlError.stack : undefined,
        );
        throw ttlError;
      }

      const count = Number(countResult);

      if (count > window.limit) {
        const ttl = Number(ttlResult);
        return {
          allowed: false,
          retryAfterMs: (ttl > 0 ? ttl : window.windowSeconds) * 1000,
        };
      }
    }

    return { allowed: true };
  }
}
