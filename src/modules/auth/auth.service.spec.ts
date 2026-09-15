import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { SessionService } from '@app/core/session/session.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const createService = () => {
    const configGet = jest.fn();
    const configGetOrThrow = jest.fn();
    const signAsync = jest.fn();
    const verifyAsync = jest.fn();
    const transaction = jest.fn();
    const sessionFindUnique = jest.fn();
    const sessionUpdate = jest.fn();
    const sessionUpdateMany = jest.fn();
    const userFindUnique = jest.fn();

    const config = {
      get: configGet,
      getOrThrow: configGetOrThrow,
    } as unknown as ConfigService;
    const jwt = { signAsync, verifyAsync } as unknown as JwtService;
    const prisma = {
      $transaction: transaction,
      session: {
        findUnique: sessionFindUnique,
        update: sessionUpdate,
        updateMany: sessionUpdateMany,
      },
      user: { findUnique: userFindUnique },
    } as unknown as PrismaService;
    const sessionService = {
      createSession: jest.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        refreshExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    } as unknown as SessionService;

    const service = new AuthService(config, jwt, prisma, sessionService);

    return {
      service,
      configGet,
      signAsync,
      verifyAsync,
      transaction,
      sessionFindUnique,
      sessionUpdate,
      sessionUpdateMany,
      userFindUnique,
      sessionService,
    };
  };

  const VALID_SESSION_ID = '123e4567-e89b-12d3-a456-426614174000';
  const VALID_SECRET = `${'A'.repeat(64)}`;
  const VALID_REFRESH_TOKEN = `${VALID_SESSION_ID}.${VALID_SECRET}`;

  it('revokes a session on logout', async () => {
    const { service, sessionUpdate } = createService();
    sessionUpdate.mockResolvedValue({});

    await service.logout(VALID_REFRESH_TOKEN);

    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { id: VALID_SESSION_ID },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('ignores malformed refresh tokens on logout', async () => {
    const { service, sessionUpdate } = createService();

    await service.logout('not-a-valid-token');

    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it('rejects malformed refresh tokens before hitting the database', async () => {
    const { service, sessionFindUnique } = createService();

    await expect(service.refresh('garbage', { })).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      service.refresh('short.secret', { }),
    ).rejects.toThrow(UnauthorizedException);
    expect(sessionFindUnique).not.toHaveBeenCalled();
  });

  it('returns the current user with profile', async () => {
    const { service, userFindUnique } = createService();
    userFindUnique.mockResolvedValue({ id: 'user-1' });

    await expect(service.getMe('user-1')).resolves.toEqual({ id: 'user-1' });
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      include: { profile: true },
    });
  });

  it('returns an authenticated user for a valid session', async () => {
    const { service, verifyAsync, sessionFindUnique } = createService();
    verifyAsync.mockResolvedValue({ id: 'user-1', sessionId: 'session-1' });
    sessionFindUnique.mockResolvedValue({
      revokedAt: null,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      user: { id: 'user-1', status: 'active', role: 'user' },
    });

    await expect(service.verifyAccessToken('access-token')).resolves.toEqual({
      id: 'user-1',
      status: 'active',
      role: 'user',
    });
  });

  it('throws when the access token session has expired', async () => {
    const { service, verifyAsync, sessionFindUnique } = createService();
    verifyAsync.mockResolvedValue({ id: 'user-1', sessionId: 'session-1' });
    sessionFindUnique.mockResolvedValue(null);

    await expect(service.verifyAccessToken('access-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('maps an unexpected token error to INVALID_ACCESS_TOKEN', async () => {
    const { service, verifyAsync } = createService();
    verifyAsync.mockRejectedValue(new Error('bad token'));

    await expect(service.verifyAccessToken('access-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
