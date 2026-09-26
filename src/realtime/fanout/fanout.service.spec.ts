import { RedisService } from '@app/core/redis/redis.service';
import {
  FanoutService,
  REALTIME_FANOUT_CHANNEL,
} from './fanout.service';

describe('FanoutService', () => {
  const createService = () => {
    const publish = jest.fn().mockResolvedValue(1);
    const redis = {
      connection: { publish },
    } as unknown as RedisService;

    return {
      service: new FanoutService(redis),
      publish,
    };
  };

  it('publishes deduplicated user events to the fanout channel', async () => {
    const { service, publish } = createService();

    await service.publishUserEvent(
      ['user-a', 'user-b', 'user-a', null, undefined],
      'connection:changed',
    );

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      REALTIME_FANOUT_CHANNEL,
      JSON.stringify({
        event: 'connection:changed',
        userIds: ['user-a', 'user-b'],
      }),
    );
  });

  it('skips publishing when no users remain', async () => {
    const { service, publish } = createService();

    await service.publishUserEvent([], 'connection:changed');

    expect(publish).not.toHaveBeenCalled();
  });

  it('never throws when Redis is down', async () => {
    const { service, publish } = createService();
    publish.mockRejectedValue(new Error('redis down'));

    await expect(
      service.publishUserEvent(['user-a'], 'connection:changed'),
    ).resolves.toBeUndefined();
  });
});
