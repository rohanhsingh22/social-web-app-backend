import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { StringValue } from 'ms';
import { PrismaService } from '@app/core/prisma/prisma.service';
import {
  AccessTokenPayload,
  AuthenticatedUser,
  FacebookProfile,
} from './auth.types';

type SessionContext = {
  ipAddress?: string;
  userAgent?: string;
};

@Injectable()
export class AuthService {
  private readonly facebookAuthUrl = 'https://www.facebook.com/v21.0/dialog/oauth';
  private readonly facebookTokenUrl =
    'https://graph.facebook.com/v21.0/oauth/access_token';
  private readonly facebookProfileUrl = 'https://graph.facebook.com/me';

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  getFacebookLoginUrl(): string {
    const appId = this.config.get<string>('auth.facebookAppId');
    const callbackUrl = this.config.get<string>('auth.facebookCallbackUrl');

    if (!appId || !callbackUrl) {
      throw new BadRequestException('FACEBOOK_AUTH_NOT_CONFIGURED');
    }

    const url = new URL(this.facebookAuthUrl);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', 'public_profile,email');
    url.searchParams.set('response_type', 'code');

    return url.toString();
  }

  async loginWithFacebookCode(code: string, context: SessionContext) {
    const facebookAccessToken = await this.exchangeFacebookCode(code);
    const facebookProfile = await this.fetchFacebookProfile(facebookAccessToken);

    const user = await this.prisma.$transaction(async (tx) => {
      const existingIdentity = await tx.authIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: 'facebook',
            providerUserId: facebookProfile.id,
          },
        },
        include: {
          user: {
            include: {
              profile: true,
            },
          },
        },
      });

      if (existingIdentity) {
        return tx.user.update({
          where: { id: existingIdentity.userId },
          data: { lastLoginAt: new Date() },
          include: { profile: true },
        });
      }

      return tx.user.create({
        data: {
          lastLoginAt: new Date(),
          identities: {
            create: {
              provider: 'facebook',
              providerUserId: facebookProfile.id,
              providerEmail: facebookProfile.email,
              providerDisplayName: facebookProfile.name,
              providerAvatarUrl: facebookProfile.picture?.data?.url,
            },
          },
          profile: {
            create: {
              username: await this.createUniqueUsername(facebookProfile.name),
              displayName: facebookProfile.name ?? 'Facebook User',
              avatarUrl: facebookProfile.picture?.data?.url,
              languages: [],
              isComplete: false,
            },
          },
        },
        include: { profile: true },
      });
    });

    if (user.status === 'banned' || user.status === 'deleted') {
      throw new ForbiddenException('ACCOUNT_NOT_ALLOWED');
    }

    const tokens = await this.createSession(user.id, context);

    return {
      user,
      ...tokens,
    };
  }

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

    const tokens = await this.createSession(session.userId, context);

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
      .catch(() => undefined);
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

      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
  }

  private async exchangeFacebookCode(code: string): Promise<string> {
    const appId = this.config.get<string>('auth.facebookAppId');
    const appSecret = this.config.get<string>('auth.facebookAppSecret');
    const callbackUrl = this.config.get<string>('auth.facebookCallbackUrl');

    if (!appId || !appSecret || !callbackUrl) {
      throw new BadRequestException('FACEBOOK_AUTH_NOT_CONFIGURED');
    }

    const url = new URL(this.facebookTokenUrl);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('code', code);

    const response = await fetch(url);

    if (!response.ok) {
      throw new UnauthorizedException('FACEBOOK_TOKEN_EXCHANGE_FAILED');
    }

    const body = (await response.json()) as { access_token?: string };

    if (!body.access_token) {
      throw new UnauthorizedException('FACEBOOK_TOKEN_MISSING');
    }

    return body.access_token;
  }

  private async fetchFacebookProfile(
    accessToken: string,
  ): Promise<FacebookProfile> {
    const url = new URL(this.facebookProfileUrl);
    url.searchParams.set('fields', 'id,name,email,picture');
    url.searchParams.set('access_token', accessToken);

    const response = await fetch(url);

    if (!response.ok) {
      throw new UnauthorizedException('FACEBOOK_PROFILE_FETCH_FAILED');
    }

    const profile = (await response.json()) as FacebookProfile;

    if (!profile.id) {
      throw new UnauthorizedException('FACEBOOK_PROFILE_INVALID');
    }

    return profile;
  }

  private async createSession(userId: string, context: SessionContext) {
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

  private decodeRefreshSessionId(refreshToken: string): string {
    const [sessionId] = refreshToken.split('.');

    if (!sessionId) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    return sessionId;
  }

  private refreshExpiresAt(): Date {
    const ttl = this.config.getOrThrow<string>('auth.refreshTokenTtl');
    const match = ttl.match(/^(\d+)([dhms])$/);

    if (!match) {
      throw new BadRequestException('INVALID_REFRESH_TOKEN_TTL');
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

  private async createUniqueUsername(displayName?: string): Promise<string> {
    const base =
      displayName
        ?.toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 20) || 'user';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const username =
        attempt === 0
          ? `${base}_${randomBytes(3).toString('hex')}`
          : `${base}_${randomBytes(5).toString('hex')}`;

      const existing = await this.prisma.profile.findUnique({
        where: { username },
      });

      if (!existing) {
        return username;
      }
    }

    return `user_${randomBytes(8).toString('hex')}`;
  }
}
