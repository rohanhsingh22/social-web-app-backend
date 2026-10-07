import { ConfigService } from '@nestjs/config';
import { HomeMemberRole } from '@prisma/client';
import { RateLimitService } from '@app/common/rate-limit.service';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { HOME_VOICE_TOKEN_TTL_SECONDS } from '../home.constants';
import { HomeVoiceProvider } from './home-voice.provider';
import { HomeVoiceService } from './home-voice.service';

describe('HomeVoiceService', () => {
  const createService = (livekitUrl?: string) => {
    const prisma = {
      homeMembership: {
        findUnique: jest.fn(),
      },
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((_key: string) => livekitUrl),
    } as unknown as ConfigService;
    const provider = {
      createAccessToken: jest.fn(),
      removeParticipant: jest.fn(),
      closeHome: jest.fn(),
    } as unknown as HomeVoiceProvider & {
      createAccessToken: jest.Mock;
    };
    const rateLimit = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitService;

    return {
      service: new HomeVoiceService(prisma, config, provider, rateLimit),
      prisma,
      provider,
      rateLimit,
    };
  };

  it('derives opaque, stable room names', () => {
    const { service } = createService('wss://livekit.example');
    const homeId = '123e4567-e89b-12d3-a456-426614174000';

    expect(service.voiceRoomNameFor(homeId)).toBe(
      'home_voice_123e4567e89b12d3a456426614174000',
    );
    expect(service.voiceRoomNameFor(homeId)).toBe(
      service.voiceRoomNameFor(homeId),
    );
  });

  it('requires Home membership for tokens', async () => {
    const { service, provider } = createService('wss://livekit.example');

    await expect(service.createVoiceToken('stranger')).rejects.toThrow(
      'NOT_HOME_MEMBER',
    );
    expect(provider.createAccessToken).not.toHaveBeenCalled();
  });

  it('fails closed without LiveKit configuration', async () => {
    const { service, prisma, provider } = createService(undefined);
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'user-1',
      role: HomeMemberRole.OWNER,
    });

    await expect(service.createVoiceToken('user-1')).rejects.toThrow(
      'VOICE_UNAVAILABLE',
    );
    expect(provider.createAccessToken).not.toHaveBeenCalled();
  });

  it('mints member-scoped tokens without leaking secrets', async () => {
    const { service, prisma, provider, rateLimit } = createService(
      'wss://livekit.example',
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'user-1',
      role: HomeMemberRole.PARTICIPANT,
    });
    const expiresAt = new Date(Date.now() + 3600_000);
    (provider.createAccessToken as jest.Mock).mockResolvedValue({
      token: 'livekit-jwt',
      expiresAt,
    });

    const result = await service.createVoiceToken('user-1');

    expect(provider.createAccessToken).toHaveBeenCalledWith({
      roomName: 'home_voice_homea',
      identity: 'user-1',
      ttlSeconds: HOME_VOICE_TOKEN_TTL_SECONDS,
    });
    expect(result).toEqual({
      token: 'livekit-jwt',
      serverUrl: 'wss://livekit.example',
      expiresAt,
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(rateLimit.assertAllowed).toHaveBeenCalledWith(
      'home:actions:rate:user-1',
      60,
      60,
    );
  });
});
