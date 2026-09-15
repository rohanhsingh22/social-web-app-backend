import { UnauthorizedException } from '@nestjs/common';
import { RedisService } from '@app/core/redis/redis.service';
import { OAuthStateService } from './oauth-state.service';

describe('OAuthStateService', () => {
  const createService = () => {
    const connection = {
      set: jest.fn().mockResolvedValue('OK'),
      getdel: jest.fn(),
    };
    const redis = {
      connection,
    } as unknown as RedisService;

    return {
      service: new OAuthStateService(redis),
      connection,
    };
  };

  it('creates a state key with short TTL', async () => {
    const { service, connection } = createService();

    const state = await service.createState('google');

    expect(state).toHaveLength(43);
    expect(connection.set).toHaveBeenCalledWith(
      `oauth:state:${state}`,
      'google',
      'EX',
      600,
      'NX',
    );
  });

  it('consumes a valid state exactly once', async () => {
    const { service, connection } = createService();
    connection.getdel.mockResolvedValue('google');

    await expect(
      service.consumeState('google', 'state-value'),
    ).resolves.toBeUndefined();
    expect(connection.getdel).toHaveBeenCalledWith(
      'oauth:state:state-value',
    );
  });

  it('rejects missing state', async () => {
    const { service } = createService();

    await expect(service.consumeState('google', undefined)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects expired or reused state', async () => {
    const { service, connection } = createService();
    connection.getdel.mockResolvedValue(null);

    await expect(
      service.consumeState('google', 'state-value'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects provider mismatch', async () => {
    const { service, connection } = createService();
    connection.getdel.mockResolvedValue('facebook');

    await expect(
      service.consumeState('google', 'state-value'),
    ).rejects.toThrow(UnauthorizedException);
  });
});
