import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { isStaffRole } from './admin-permissions';

export type AdminAccessTokenPayload = {
  id: string;
  status: string;
  role: string;
  sessionId: string;
  mfa: boolean;
};

export type AdminRequestUser = {
  id: string;
  status: string;
  role: 'owner' | 'admin' | 'moderator';
  sessionId: string;
};

export type AdminAuthenticatedRequest = Request & {
  admin: AdminRequestUser;
};

export const ADMIN_JWT_AUDIENCE = 'hirotoli-admin';

/**
 * Verifies an isolated admin session. Social JWTs (aud hirotoli-client, Session
 * table) are rejected by audience AND by the mandatory AdminSession DB lookup,
 * which additionally enforces revocation, absolute/idle expiry, MFA and
 * role-staleness on every request. DB is the authority; no role caching here.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('ADMIN_AUTH_REQUIRED');
    }

    let payload: AdminAccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminAccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.jwtAccessSecret'),
        issuer: this.config.get<string>('auth.jwtIssuer') ?? 'hirotoli-api',
        audience: ADMIN_JWT_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('ADMIN_TOKEN_INVALID');
    }

    if (!payload.mfa || !payload.sessionId || !payload.id) {
      throw new UnauthorizedException('ADMIN_TOKEN_INVALID');
    }

    const session = await this.prisma.adminSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        user: { select: { id: true, status: true, role: true } },
      },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('ADMIN_SESSION_EXPIRED');
    }

    if (!session.mfaAt) {
      throw new UnauthorizedException('ADMIN_MFA_REQUIRED');
    }

    const idleMinutes = this.config.get<number>('admin.sessionIdleMinutes') ?? 30;
    if (
      Date.now() - session.lastSeenAt.getTime() >
      idleMinutes * 60 * 1000
    ) {
      throw new UnauthorizedException('ADMIN_SESSION_IDLE');
    }

    if (session.user.status !== 'active' || !isStaffRole(session.user.role)) {
      throw new ForbiddenException('ADMIN_ACCESS_REVOKED');
    }

    // Role changed after the token was minted: force re-authentication so a
    // demoted staff member cannot ride out the old token's TTL.
    if (payload.role !== session.user.role) {
      throw new ForbiddenException('ADMIN_ROLE_STALE');
    }

    // Sliding idle window, throttled to one write per minute per session.
    if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.adminSession
        .update({
          where: { id: session.id },
          data: { lastSeenAt: new Date() },
        })
        .catch(() => undefined);
    }

    request.admin = {
      id: session.user.id,
      status: session.user.status,
      role: session.user.role as AdminRequestUser['role'],
      sessionId: session.id,
    };
    return true;
  }

  private extractToken(request: Request): string | undefined {
    // Header only. The social access_token cookie fallback must never
    // authenticate admin routes.
    const authHeader = request.header('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length);
    }
    return undefined;
  }
}
