import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimitService } from '@app/common/rate-limit.service';
import { PrismaService } from '@app/core/prisma/prisma.service';
import {
  HOME_ACTION_RATE_LIMIT,
  HOME_ACTION_RATE_WINDOW_SECONDS,
  HOME_VOICE_ROOM_PREFIX,
  HOME_VOICE_TOKEN_TTL_SECONDS,
} from '../home.constants';
import { HomeVoiceProvider } from './home-voice.provider';

/**
 * Home voice orchestration (Phase 7).
 * Authorizes membership, derives the opaque room name, and mints tokens.
 * Media state stays in the SFU; this service never tracks who is speaking.
 */
@Injectable()
export class HomeVoiceService {
  private readonly logger = new Logger(HomeVoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly provider: HomeVoiceProvider,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Opaque, stable room name per Home — never a raw database id (spec #54). */
  voiceRoomNameFor(homeId: string): string {
    return `${HOME_VOICE_ROOM_PREFIX}${homeId.replace(/-/g, '')}`;
  }

  async createVoiceToken(userId: string) {
    await this.rateLimit.assertAllowed(
      `home:actions:rate:${userId}`,
      HOME_ACTION_RATE_LIMIT,
      HOME_ACTION_RATE_WINDOW_SECONDS,
    );
    const membership = await this.prisma.homeMembership.findUnique({
      where: { userId },
    });
    if (!membership) {
      throw new ForbiddenException('NOT_HOME_MEMBER');
    }

    const serverUrl = this.config.get<string>('voice.livekitUrl');
    if (!serverUrl) {
      throw new ServiceUnavailableException('VOICE_UNAVAILABLE');
    }

    const roomName = this.voiceRoomNameFor(membership.homeId);
    const { token, expiresAt } = await this.provider.createAccessToken({
      roomName,
      identity: userId,
      ttlSeconds: HOME_VOICE_TOKEN_TTL_SECONDS,
    });

    this.logger.log(
      `home.voice.token home=${membership.homeId} user=${userId}`,
    );
    return { token, serverUrl, expiresAt };
  }

  /** Owner-removal path: force-disconnect a member from the SFU room. */
  async removeVoiceParticipant(homeId: string, userId: string): Promise<void> {
    await this.provider.removeParticipant(
      this.voiceRoomNameFor(homeId),
      userId,
    );
    this.logger.log(`home.voice.removed home=${homeId} user=${userId}`);
  }

  /** Owner-leave path: tear down the SFU room for a destroyed Home. */
  async closeVoiceHome(homeId: string): Promise<void> {
    await this.provider.closeHome(this.voiceRoomNameFor(homeId));
    this.logger.log(`home.voice.closed home=${homeId}`);
  }
}
