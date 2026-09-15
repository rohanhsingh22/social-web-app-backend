import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { RedisService } from '@app/core/redis/redis.service';

const OAUTH_STATE_TTL_SECONDS = 600;
const OAUTH_STATE_KEY_PREFIX = 'oauth:state:';

@Injectable()
export class OAuthStateService {
  private readonly logger = new Logger(OAuthStateService.name);

  constructor(private readonly redis: RedisService) {}

  async createState(providerId: string): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    const key = this.keyFor(state);

    try {
      await this.redis.connection.set(
        key,
        providerId,
        'EX',
        OAUTH_STATE_TTL_SECONDS,
        'NX',
      );
    } catch (error) {
      this.logger.error(
        'Failed to store OAuth state; failing closed',
        error instanceof Error ? error.stack : undefined,
      );
      throw new UnauthorizedException('OAUTH_STATE_FAILED');
    }

    return state;
  }

  async consumeState(providerId: string, state: string | undefined): Promise<void> {
    if (!state) {
      throw new UnauthorizedException('OAUTH_STATE_REQUIRED');
    }

    const key = this.keyFor(state);

    let stored: string | null;
    try {
      stored = await this.redis.connection.getdel(key);
    } catch (error) {
      this.logger.error(
        'Failed to validate OAuth state; failing closed',
        error instanceof Error ? error.stack : undefined,
      );
      throw new UnauthorizedException('OAUTH_STATE_FAILED');
    }

    if (!stored) {
      throw new UnauthorizedException('OAUTH_STATE_INVALID');
    }

    if (stored !== providerId) {
      this.logger.warn(
        `OAuth state provider mismatch: expected ${providerId}`,
      );
      throw new UnauthorizedException('OAUTH_STATE_INVALID');
    }
  }

  private keyFor(state: string): string {
    return `${OAUTH_STATE_KEY_PREFIX}${state}`;
  }
}
