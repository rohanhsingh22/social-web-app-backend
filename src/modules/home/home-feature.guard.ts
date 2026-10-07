import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Rollout lever for Hirotoli Home (spec #136). When
 * HOME_SOCIAL_VOICE_ENABLED is off, every /home route fails closed with
 * HOME_DISABLED — no code revert, no partial feature surface.
 */
@Injectable()
export class HomeFeatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    const enabled = this.config.get<boolean>('home.enabled', true);
    if (!enabled) {
      throw new ServiceUnavailableException('HOME_DISABLED');
    }
    return true;
  }
}
