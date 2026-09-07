import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { StringValue } from 'ms';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { AccessTokenPayload } from '@app/modules/auth/auth.types';

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
  ): Promise<CreatedSession> {
    const refreshTokenValue = randomBytes(48).toString('base64url');
    const expiresAt = this.refreshExpiresAt();

    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: 'pending',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        expiresAt,
      },
      include: {
        user: true,
      },
    });

    const refreshToken = `${session.id}.${refreshTokenValue}`;
    const refreshTokenHash = await argon2.hash(refreshToken);

    await this.prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash },
    });

    const accessToken = await this.jwt.signAsync(
      {
        id: session.user.id,
        status: session.user.status,
        role: session.user.role,
        sessionId: session.id,
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
