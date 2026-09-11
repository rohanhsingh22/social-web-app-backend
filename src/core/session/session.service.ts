import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { StringValue } from 'ms';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { AccessTokenPayload } from '@app/modules/auth/auth.types';
import type { User } from '@prisma/client';

export type SessionContext = {
  ipAddress?: string;
  userAgent?: string;
};

export type CreatedSession = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
};

@Injectable()
export class SessionService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async createSession(
    userId: string,
    context: SessionContext,
    user: Pick<User, 'status' | 'role'>,
  ): Promise<CreatedSession> {
    const sessionId = randomUUID();
    const refreshTokenValue = randomBytes(48).toString('base64url');
    const refreshToken = `${sessionId}.${refreshTokenValue}`;
    const refreshTokenHash = await argon2.hash(refreshToken);
    const expiresAt = this.refreshExpiresAt();

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        expiresAt,
      },
    });

    const accessToken = await this.jwt.signAsync(
      {
        id: userId,
        status: user.status,
        role: user.role,
        sessionId,
      } satisfies AccessTokenPayload,
      {
        secret: this.config.getOrThrow<string>('auth.jwtAccessSecret'),
        expiresIn:
          this.config.getOrThrow<StringValue>('auth.accessTokenTtl'),
      },
    );

    return {
      accessToken,
      refreshToken,
      refreshExpiresAt: expiresAt,
    };
  }

  private refreshExpiresAt(): Date {
    const ttl = this.config.getOrThrow<string>('auth.refreshTokenTtl');
    const match = ttl.match(/^(\d+)([dhms])$/);

    if (!match) {
      throw new Error('INVALID_REFRESH_TOKEN_TTL');
    }

    const amount = Number(match[1]);
    const unit = match[2];
    const millisecondsByUnit: Record<string, number> = {
      d: 24 * 60 * 60 * 1000,
      h: 60 * 60 * 1000,
      m: 60 * 1000,
      s: 1000,
    };

    return new Date(Date.now() + amount * millisecondsByUnit[unit]);
  }
}
