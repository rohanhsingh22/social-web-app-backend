import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  const createController = () => {
    const refresh = jest.fn();
    const logout = jest.fn();
    const getMe = jest.fn();
    const configGet = jest.fn();

    const authService = {
      refresh,
      logout,
      getMe,
    } as unknown as AuthService;
    const config = {
      get: configGet,
      getOrThrow: jest.fn(),
    } as unknown as ConfigService;

    const controller = new AuthController(authService, config);

    return { controller, authService, configGet, logout };
  };

  const createResponse = () =>
    ({
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      redirect: jest.fn(),
    }) as unknown as Response;

  it('clears cookies on logout', async () => {
    const { controller, logout } = createController();
    const response = createResponse();
    const request = {
      cookies: { refresh_token: 'refresh-token' },
      ip: '127.0.0.1',
      header: jest.fn(),
    } as unknown as Request;

    await controller.logout(request, response);

    expect(logout).toHaveBeenCalledWith('refresh-token');
    expect(response.clearCookie).toHaveBeenCalledWith('access_token');
    expect(response.clearCookie).toHaveBeenCalledWith('refresh_token');
  });
});
