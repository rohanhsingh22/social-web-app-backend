import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { SessionService, SessionContext } from '@app/core/session/session.service';
import { ProviderRegistry } from './providers/provider.registry';
import { NormalizedProfile, ProviderInfo } from './providers/oauth-provider.interface';

type LoginResult = {
  user: {
    id: string;
    status: string;
    role: string;
    profile: {
      username: string;
      displayName: string;
      avatarUrl: string | null;
    } | null;
  };
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  getAvailableProviders(): ProviderInfo[] {
    return this.providerRegistry.getAvailableProviders();
  }

  async loginWithCode(
    providerId: string,
    code: string,
    context: SessionContext,
  ): Promise<LoginResult> {
    const provider = this.providerRegistry.getProvider(providerId);

    const accessToken = await provider.exchangeCode(code);
    const profile = await provider.fetchProfile(accessToken);

    const user = await this.upsertUser(providerId, profile);

    if (user.status === 'banned' || user.status === 'deleted') {
      throw new ForbiddenException('ACCOUNT_NOT_ALLOWED');
    }

    const tokens = await this.sessionService.createSession(user.id, context);

    return {
      user,
      ...tokens,
    };
  }

  private async upsertUser(providerId: string, profile: NormalizedProfile) {
    return this.prisma.$transaction(async (tx) => {
      const existingIdentity = await tx.authIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: providerId,
            providerUserId: profile.providerUserId,
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
              provider: providerId,
              providerUserId: profile.providerUserId,
              providerEmail: profile.email,
              providerDisplayName: profile.displayName,
              providerAvatarUrl: profile.avatarUrl,
            },
          },
          profile: {
            create: {
              username: await this.createUniqueUsername(tx, profile.displayName),
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
              languages: [],
              isComplete: false,
            },
          },
        },
        include: { profile: true },
      });
    });
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
