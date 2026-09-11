import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { RedisService } from "@app/core/redis/redis.service";

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(private readonly redis: RedisService) {}

  async assertAllowed(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const results = await this.redis.connection
      .multi()
      .incr(key)
      .expire(key, windowSeconds, "NX")
      .ttl(key)
      .exec();

    const [[incrError, countResult], , [ttlError, ttlResult]] = results ?? [];

    if (incrError || ttlError) {
      const error = incrError ?? ttlError;
      this.logger.error(
        `Rate limit check failed for ${key}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException("RATE_LIMIT_UNAVAILABLE");
    }

    const count = Number(countResult);

    if (count > limit) {
      const ttl = Number(ttlResult);
      throw new HttpException(
        {
          message: "RATE_LIMITED",
          retryAfterMs: (ttl > 0 ? ttl : windowSeconds) * 1000,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
