import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { SessionService, SessionContext } from '@app/core/session/session.service';
import {
  AccessTokenPayload,
  AuthenticatedUser,
} from './auth.types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
  ) {}

  async refresh(refreshToken: string, context: SessionContext) {
    if (!refreshToken) {
      throw new UnauthorizedException('REFRESH_TOKEN_REQUIRED');
    }

    const sessionId = this.decodeRefreshSessionId(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        user: {
          include: {
            profile: true,
          },
        },
      },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('SESSION_EXPIRED');
    }

    const isValid = await argon2.verify(
      session.refreshTokenHash,
      refreshToken,
    );

    if (!isValid) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    if (
      session.user.status === 'banned' ||
      session.user.status === 'deleted'
    ) {
      throw new ForbiddenException('ACCOUNT_NOT_ALLOWED');
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
      },
    });

    const tokens = await this.sessionService.createSession(
      session.userId,
      context,
      {
        status: session.user.status,
        role: session.user.role,
      },
    );

    return {
      user: session.user,
      ...tokens,
    };
  }

  async logout(refreshToken?: string) {
    if (!refreshToken) {
      return;
    }

    const sessionId = this.decodeRefreshSessionId(refreshToken);

    await this.prisma.session
      .update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      })
      .catch((error) => {
        this.logger.error(
          `Failed to revoke session ${sessionId} during logout`,
          error instanceof Error ? error.stack : undefined,
        );
      });
  }

  async getMe(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
      },
    });
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.jwtAccessSecret'),
      });

      const session = await this.prisma.session.findUnique({
        where: { id: payload.sessionId },
        include: { user: true },
      });

      if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        throw new UnauthorizedException('SESSION_EXPIRED');
      }

      if (
        session.user.status === 'banned' ||
        session.user.status === 'deleted'
      ) {
        throw new ForbiddenException('ACCOUNT_NOT_ALLOWED');
      }

      return {
        id: payload.id,
        status: session.user.status,
        role: session.user.role,
      };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      this.logger.error(
        'Access token verification failed',
        error instanceof Error ? error.stack : undefined,
      );
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
  }

  private decodeRefreshSessionId(refreshToken: string): string {
    const [sessionId] = refreshToken.split('.');

    if (!sessionId) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    return sessionId;
  }

  private async createUniqueUsername(
    tx: Prisma.TransactionClient,
    displayName: string,
  ): Promise<string> {
    const base = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 20) || 'user';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const username =
        attempt === 0
          ? `${base}_${randomBytes(3).toString('hex')}`
          : `${base}_${randomBytes(5).toString('hex')}`;

      const existing = await tx.profile.findUnique({
        where: { username },
      });

      if (!existing) {
        return username;
      }
    }

    return `user_${randomBytes(8).toString('hex')}`;
  }
}
