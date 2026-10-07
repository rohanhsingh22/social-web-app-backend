import { ConfigService } from '@nestjs/config';
import { LivekitHomeVoiceProvider } from './livekit-home-voice.provider';

describe('LivekitHomeVoiceProvider', () => {
  const createProvider = (env: Record<string, string | undefined>) => {
    const config = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    return new LivekitHomeVoiceProvider(config);
  };

  const fullEnv = {
    'voice.livekitUrl': 'wss://livekit.example',
    'voice.livekitApiKey': 'test-key',
    'voice.livekitApiSecret': 'test-secret-test-secret-test-se12',
  };

  it('mints scoped join tokens', async () => {
    const provider = createProvider(fullEnv);

    const { token, expiresAt } = await provider.createAccessToken({
      roomName: 'home_voice_homea',
      identity: 'user-1',
      ttlSeconds: 3600,
    });

    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    );
    expect(payload['sub']).toBe('user-1');
    expect(payload['video']).toEqual(
      expect.objectContaining({
        roomJoin: true,
        room: 'home_voice_homea',
        canPublish: true,
        canSubscribe: true,
      }),
    );
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('fails closed without configuration', async () => {
    const provider = createProvider({});

    await expect(
      provider.createAccessToken({
        roomName: 'home_voice_homea',
        identity: 'user-1',
        ttlSeconds: 3600,
      }),
    ).rejects.toThrow('VOICE_UNAVAILABLE');
    await expect(
      provider.removeParticipant('home_voice_homea', 'user-1'),
    ).rejects.toThrow('VOICE_UNAVAILABLE');
    await expect(provider.closeHome('home_voice_homea')).rejects.toThrow(
      'VOICE_UNAVAILABLE',
    );
  });
});
