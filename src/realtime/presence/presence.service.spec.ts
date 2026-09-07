import { PresenceService } from './presence.service';
import { RedisService } from '@app/core/redis/redis.service';

describe('PresenceService', () => {
  const createService = () => {
    const zadd = jest.fn();
    const zrem = jest.fn();
    const zcount = jest.fn();
    const zremrangebyscore = jest.fn();
    const expire = jest.fn();
    const scan = jest.fn();

    const redis = {
      connection: { zadd, zrem, zcount, zremrangebyscore, expire, scan },
    } as unknown as RedisService;

    return {
      service: new PresenceService(redis),
      zadd,
      zrem,
      zcount,
      zremrangebyscore,
      expire,
      scan,
    };
  };

  it('marks a user online and sets a presence TTL', async () => {
    const { service, zadd, expire } = createService();

    await service.markOnline('user-id', 'socket-id');

    expect(zadd).toHaveBeenCalledWith(
      'presence:user:user-id',
      expect.any(Number),
      'socket-id',
    );
    expect(expire).toHaveBeenCalledWith('presence:user:user-id', 60);
  });

  it('removes a socket on markOffline', async () => {
    const { service, zrem } = createService();

    await service.markOffline('user-id', 'socket-id');

    expect(zrem).toHaveBeenCalledWith('presence:user:user-id', 'socket-id');
  });

  it('tracks channel membership via zset', async () => {
    const { service, zadd, zrem, expire } = createService();

    await service.joinChannel('channel-id', 'user-id');
    await service.leaveChannel('channel-id', 'user-id');

    expect(zadd).toHaveBeenCalledWith(
      'presence:channel:channel-id',
      expect.any(Number),
      'user-id',
    );
    expect(expire).toHaveBeenCalledWith('presence:channel:channel-id', 60);
    expect(zrem).toHaveBeenCalledWith('presence:channel:channel-id', 'user-id');
  });

  it('returns the online count for a channel', async () => {
    const { service, zcount } = createService();
    zcount.mockResolvedValue(5);

    await expect(service.onlineCount('channel-id')).resolves.toBe(5);
    expect(zcount).toHaveBeenCalledWith(
      'presence:channel:channel-id',
      expect.any(Number),
      '+inf',
    );
  });

  it('reports whether a user is online', async () => {
    const { service, zcount } = createService();
    zcount.mockResolvedValue(1);

    await expect(service.isUserOnline('user-id')).resolves.toBe(true);
  });

  it('sweeps stale presence entries across all presence keys', async () => {
    const { service, scan, zremrangebyscore } = createService();
    scan
      .mockResolvedValueOnce(['0', ['presence:user:a', 'presence:channel:b']]);

    await service.sweepStale();

    expect(scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'presence:*',
      'COUNT',
      100,
    );
    expect(zremrangebyscore).toHaveBeenCalledTimes(2);
  });
});
