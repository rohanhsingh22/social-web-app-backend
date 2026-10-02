import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { OAuthStateService } from '@app/modules/integration/oauth-state.service';
import { ProviderRegistry } from '@app/modules/integration/providers/provider.registry';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuthService } from './admin-auth.service';
import { TotpService } from './totp.service';

describe('AdminAuthService', () => {
  const configValues: Record<string, unknown> = {
    'admin.googleCallbackUrl': 'http://localhost:3001/admin/auth/callback/google',
    'admin.appBaseUrl': 'http://localhost:5174',
    'admin.accessTokenTtl': '10m',
    'admin.sessionIdleMinutes': 30,
    'admin.sessionAbsoluteHours': 12,
    'admin.mfaPendingMinutes': 10,
    'admin.inviteTtlHours': 48,
    'auth.jwtAccessSecret': 'test-secret',
    'auth.jwtIssuer': 'hirotoli-api',
  };

  const createService = (overrides?: {
    prismaExtra?: Record<string, unknown>;
    providerProfile?: unknown;
    identity?: unknown;
  }) => {
    const tx = {
      user: { update: jest.fn() },
      adminInvitation: { update: jest.fn(), updateMany: jest.fn() },
      adminSession: { updateMany: jest.fn() },
      adminAuditEvent: { create: jest.fn() },
    };
    const prisma = {
      authIdentity: {
        findUnique: jest.fn().mockResolvedValue(overrides?.identity ?? null),
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      adminSession: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      adminMfaCredential: { findUnique: jest.fn(), update: jest.fn() },
      adminRecoveryCode: { findMany: jest.fn().mockResolvedValue([]) },
      adminInvitation: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((callback: (t: typeof tx) => unknown) =>
        callback(tx),
      ),
      ...(overrides?.prismaExtra ?? {}),
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((key: string) => configValues[key]),
      getOrThrow: jest.fn((key: string) => {
        if (configValues[key] === undefined) {
          throw new Error(`missing ${key}`);
        }
        return configValues[key];
      }),
    } as unknown as ConfigService;
    const jwt = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
      verifyAsync: jest.fn(),
    } as unknown as JwtService;
    const totp = {
      verify: jest.fn(),
      decryptSecret: jest.fn(),
      encryptSecret: jest.fn().mockReturnValue('v1.enc'),
      generateSecret: jest
        .fn()
        .mockReturnValue({ raw: Buffer.alloc(20), base32: 'ABC' }),
      otpauthUri: jest.fn().mockReturnValue('otpauth://x'),
      generateRecoveryCodes: jest.fn().mockReturnValue(['AAAAA-BBBBB']),
      normalizeRecoveryCode: jest.fn((code: string) => code),
    } as unknown as TotpService;
    const audit = {
      log: jest.fn().mockResolvedValue({}),
    } as unknown as AdminAuditService;
    const oauthState = {
      createState: jest.fn().mockResolvedValue('state-1'),
      consumeState: jest.fn().mockResolvedValue(undefined),
    } as unknown as OAuthStateService;
    const providers = {
      getProvider: jest.fn().mockReturnValue({
        getLoginUrl: jest.fn().mockResolvedValue('https://google/login'),
        exchangeCode: jest.fn().mockResolvedValue('provider-token'),
        fetchProfile: jest
          .fn()
          .mockResolvedValue(
            overrides?.providerProfile ?? { providerUserId: 'g-1' },
          ),
      }),
    } as unknown as ProviderRegistry;

    const service = new AdminAuthService(
      config,
      jwt,
      prisma,
      totp,
      audit,
      oauthState,
      providers,
    );
    return { service, prisma, config, jwt, totp, audit, oauthState, providers, tx };
  };

  const staffIdentity = (role: UserRole, status = 'active') => ({
    user: {
      id: 'user-1',
      status,
      role,
      mfaCredential: { id: 'mfa-1', lastUsedAt: new Date() },
    },
  });

  describe('handleCallback', () => {
    it('denies unknown OAuth identities without a session', async () => {
      const { service } = createService({ identity: null });
      await expect(
        service.handleCallback('code', 'state', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('denies ordinary users (no privilege escalation via OAuth)', async () => {
      const { service } = createService({
        identity: staffIdentity(UserRole.user),
      });
      await expect(
        service.handleCallback('code', 'state', {}),
      ).rejects.toThrow('ADMIN_ACCESS_DENIED');
    });

    it('denies banned staff with the same generic code', async () => {
      const { service } = createService({
        identity: staffIdentity(UserRole.admin, 'banned'),
      });
      await expect(
        service.handleCallback('code', 'state', {}),
      ).rejects.toThrow('ADMIN_ACCESS_DENIED');
    });

    it('issues a pending token for verified staff', async () => {
      const { service, jwt } = createService({
        identity: staffIdentity(UserRole.moderator),
      });
      const result = await service.handleCallback('code', 'state', {
        ipAddress: '127.0.0.1',
      });
      expect(result.pendingToken).toBe('signed-token');
      expect(result.needsSetup).toBe(false);
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1' }),
        expect.objectContaining({ audience: 'hirotoli-admin-pending' }),
      );
    });
  });

  describe('changeRole', () => {
    it('blocks self role changes', async () => {
      const { service } = createService();
      await expect(
        service.changeRole('owner-1', UserRole.owner, 'owner-1', UserRole.admin),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks last-owner demotion', async () => {
      const { service, prisma } = createService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'owner-1',
        status: 'active',
        role: UserRole.owner,
      });
      (prisma.user.count as jest.Mock).mockResolvedValue(0);
      await expect(
        service.changeRole('owner-2', UserRole.owner, 'owner-1', UserRole.admin),
      ).rejects.toThrow(ConflictException);
    });

    it('revokes sessions and audits successful changes', async () => {
      const { service, prisma, tx } = createService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'mod-1',
        status: 'active',
        role: UserRole.moderator,
      });
      (tx.user.update as jest.Mock).mockResolvedValue({
        id: 'mod-1',
        role: UserRole.admin,
      });
      const result = await service.changeRole(
        'owner-1',
        UserRole.owner,
        'mod-1',
        UserRole.admin,
      );
      expect(result).toEqual({ id: 'mod-1', role: UserRole.admin, changed: true });
      expect(tx.adminSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'mod-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('invitations', () => {
    it('refuses to invite existing staff', async () => {
      const { service, prisma } = createService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u-2',
        status: 'active',
        role: UserRole.moderator,
      });
      await expect(
        service.createInvitation('owner-1', UserRole.owner, 'u-2', UserRole.admin),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects acceptance by a different user', async () => {
      const { service, prisma } = createService();
      (prisma.adminInvitation.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv-1',
        userId: 'u-2',
        role: UserRole.moderator,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      await expect(
        service.acceptInvitation('u-3', 'inv_raw', {}),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('bootstrapOwner', () => {
    it('promotes the first owner freely', async () => {
      const { service, prisma, tx } = createService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u-1',
        status: 'active',
        role: UserRole.admin,
      });
      (prisma.user.count as jest.Mock).mockResolvedValue(0);
      (tx.user.update as jest.Mock).mockResolvedValue({
        id: 'u-1',
        role: UserRole.owner,
      });
      await expect(service.bootstrapOwner('u-1')).resolves.toEqual({
        id: 'u-1',
        role: UserRole.owner,
        changed: true,
      });
    });

    it('requires owner approval once owners exist', async () => {
      const { service, prisma } = createService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u-1',
        status: 'active',
        role: UserRole.admin,
      });
      (prisma.user.count as jest.Mock).mockResolvedValue(1);
      await expect(service.bootstrapOwner('u-1')).rejects.toThrow(
        'OWNER_APPROVAL_REQUIRED',
      );
    });
  });

  describe('refresh', () => {
    it('rejects revoked sessions', async () => {
      const { service, prisma } = createService();
      const sessionId = '11111111-1111-4111-8111-111111111111';
      (prisma.adminSession.findUnique as jest.Mock).mockResolvedValue({
        id: sessionId,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        mfaAt: new Date(),
        lastSeenAt: new Date(),
        user: { id: 'u-1', status: 'active', role: UserRole.admin },
      });
      await expect(
        service.refresh(`${sessionId}.${'s'.repeat(64)}`, {}),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
