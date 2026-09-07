import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './auth.types';

const createContext = (request: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as ExecutionContext;

describe('AuthGuard', () => {
  it('attaches a user from a bearer token', async () => {
    const user: AuthenticatedUser = {
      id: 'user-id',
      status: 'active',
      role: 'user',
    };
    const authService = {
      verifyAccessToken: jest.fn().mockResolvedValue(user),
    } as unknown as AuthService;
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const guard = new AuthGuard(authService, reflector);
    const request = {
      header: jest.fn().mockReturnValue('Bearer access-token'),
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(authService.verifyAccessToken).toHaveBeenCalledWith('access-token');
    expect(request).toMatchObject({ user });
  });

  it('rejects requests without a token', async () => {
    const authService = {
      verifyAccessToken: jest.fn(),
    } as unknown as AuthService;
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const guard = new AuthGuard(authService, reflector);
    const request = {
      header: jest.fn().mockReturnValue(undefined),
      cookies: {},
    };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(authService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('allows public routes without a token', async () => {
    const authService = {
      verifyAccessToken: jest.fn(),
    } as unknown as AuthService;
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const guard = new AuthGuard(authService, reflector);
    const request = {
      header: jest.fn().mockReturnValue(undefined),
      cookies: {},
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(authService.verifyAccessToken).not.toHaveBeenCalled();
  });
});
