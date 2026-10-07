import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HomeFeatureGuard } from './home-feature.guard';

describe('HomeFeatureGuard', () => {
  const createGuard = (enabled?: boolean) => {
    const config = {
      get: jest.fn((_key: string, fallback?: boolean) =>
        enabled === undefined ? fallback : enabled,
      ),
    } as unknown as ConfigService;
    return new HomeFeatureGuard(config);
  };

  it('allows requests when the flag is on', () => {
    expect(
      createGuard(true).canActivate({} as never),
    ).toBe(true);
  });

  it('defaults to enabled when unconfigured', () => {
    expect(
      createGuard(undefined).canActivate({} as never),
    ).toBe(true);
  });

  it('fails closed with HOME_DISABLED when off', () => {
    const guard = createGuard(false);

    expect(() => guard.canActivate({} as never)).toThrow(
      ServiceUnavailableException,
    );
    expect(() => guard.canActivate({} as never)).toThrow('HOME_DISABLED');
  });
});
