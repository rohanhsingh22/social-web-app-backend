import { RealtimeRateLimitService } from './realtime-rate-limit.service';
import { RedisService } from '@app/core/redis/redis.service';

describe('RealtimeRateLimitService', () => {
  const createService = () => {
    const incr = jest.fn();
    const expire = jest.fn();
    const ttl = jest.fn();
    const exec = jest.fn();
    const chain = { incr, expire, ttl, exec };

    incr.mockReturnValue(chain);
    expire.mockReturnValue(chain);
    ttl.mockReturnValue(chain);

    const redis = {
      connection: { multi: jest.fn().mockReturnValue(chain) },
    } as unknown as RedisService;

    return {
      service: new RealtimeRateLimitService(redis),
      exec,
    };
  };

  it('allows messages within the user and channel limits', async () => {
    const { service, exec } = createService();
    exec
      .mockResolvedValueOnce([
        [null, 1],
        [null, 1],
        [null, 2],
      ])
      .mockResolvedValueOnce([
        [null, 1],
        [null, 1],
        [null, 10],
      ])
      .mockResolvedValueOnce([
        [null, 1],
        [null, 1],
        [null, 1],
      ]);

    await expect(
      service.checkChannelMessage('user-id', 'channel-id'),
    ).resolves.toEqual({ allowed: true });
  });

  it('blocks messages over the per-user rate limit', async () => {
    const { service, exec } = createService();
    exec.mockResolvedValue([
      [null, 4],
      [null, 1],
      [null, 1],
    ]);

    await expect(
      service.checkChannelMessage('user-id', 'channel-id'),
    ).resolves.toEqual({
      allowed: false,
      retryAfterMs: 1000,
    });
  });

  it('blocks messages over the per-channel rate limit', async () => {
    const { service, exec } = createService();
    exec
      .mockResolvedValueOnce([
        [null, 1],
        [null, 1],
        [null, 2],
      ])
      .mockResolvedValueOnce([
        [null, 1],
        [null, 1],
        [null, 10],
      ])
      .mockResolvedValueOnce([
        [null, 31],
        [null, 1],
        [null, 1],
      ]);

    await expect(
      service.checkChannelMessage('user-id', 'channel-id'),
    ).resolves.toEqual({
      allowed: false,
      retryAfterMs: 1000,
    });
  });
});
