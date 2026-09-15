import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { generatePublicUserId } from '@app/common/public-user-id';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { SessionService, SessionContext } from '@app/core/session/session.service';
import { ProviderRegistry } from './providers/provider.registry';
import { NormalizedProfile, ProviderInfo } from './providers/oauth-provider.interface';

const PUBLIC_USER_ID_CREATE_ATTEMPTS = 5;

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

    const tokens = await this.sessionService.createSession(
      user.id,
      context,
      {
        status: user.status,
        role: user.role,
      },
    );

    return {
      user,
      ...tokens,
    };
  }

  private async upsertUser(providerId: string, profile: NormalizedProfile) {
    for (let attempt = 0; attempt < PUBLIC_USER_ID_CREATE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
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
            const previousProviderAvatarUrl =
              existingIdentity.providerAvatarUrl;
            const currentProfileAvatarUrl =
              existingIdentity.user.profile?.avatarUrl ?? null;

            await tx.authIdentity.update({
              where: { id: existingIdentity.id },
              data: {
                providerEmail: profile.email,
                providerDisplayName: profile.displayName,
                providerAvatarUrl: profile.avatarUrl,
              },
            });

            // HiRotoli-owned fields (displayName, bio, Toli, interests,
            // profile-picture choice, 3D character) must never be overwritten
            // by provider data. Only keep tracking the provider avatar while
            // the profile is still using it; a custom/Toli avatar is left alone
            // (full profilePictureType split lands in Phase 2).
            const tracksProviderAvatar =
              !currentProfileAvatarUrl ||
              (previousProviderAvatarUrl !== null &&
                currentProfileAvatarUrl === previousProviderAvatarUrl);

            return tx.user.update({
              where: { id: existingIdentity.userId },
              data: {
                lastLoginAt: new Date(),
                ...(tracksProviderAvatar &&
                profile.avatarUrl !== currentProfileAvatarUrl
                  ? {
                      profile: {
                        update: {
                          avatarUrl: profile.avatarUrl,
                        },
                      },
                    }
                  : {}),
              },
              include: { profile: true },
            });
          }

          const displayName = await this.createUniqueDisplayName(
            tx,
            profile.displayName,
          );

          return tx.user.create({
            data: {
              publicUserId: generatePublicUserId(),
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
                  username: await this.createUniqueUsername(tx, displayName),
                  displayName,
                  displayNameNormalized: displayName.toLowerCase(),
                  avatarUrl: profile.avatarUrl,
                  languages: [],
                  isComplete: false,
                },
              },
            },
            include: { profile: true },
          });
        });
      } catch (error) {
        if (
          (this.isPublicUserIdUniqueConflict(error) ||
            this.isDisplayNameUniqueConflict(error)) &&
          attempt < PUBLIC_USER_ID_CREATE_ATTEMPTS - 1
        ) {
          this.logger.warn(
            `Unique conflict on OAuth signup; retrying (attempt ${attempt + 1})`,
          );
          continue;
        }

        throw error;
      }
    }

    throw new Error('Failed to allocate unique publicUserId');
  }

  private isPublicUserIdUniqueConflict(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;
    if (typeof target === 'string') {
      return target.includes('public_user_id') || target.includes('publicUserId');
    }

    if (Array.isArray(target)) {
      return target.some(
        (value) =>
          value === 'public_user_id' ||
          value === 'publicUserId' ||
          (typeof value === 'string' && value.includes('public_user_id')),
      );
    }

    return false;
  }

  private isDisplayNameUniqueConflict(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;
    const values =
      typeof target === 'string'
        ? [target]
        : Array.isArray(target)
          ? target
          : [];

    return values.some(
      (value) => typeof value === 'string' && value.includes('display_name'),
    );
  }

  private async createUniqueDisplayName(
    tx: Prisma.TransactionClient,
    displayName: string,
  ): Promise<string> {
    const base = displayName.trim().slice(0, 60) || 'HiRotoli User';

    const existing = await tx.profile.findUnique({
      where: { displayNameNormalized: base.toLowerCase() },
      select: { userId: true },
    });

    if (!existing) {
      return base;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `${base.slice(0, 50)}_${randomBytes(3).toString('hex')}`;
      const clash = await tx.profile.findUnique({
        where: { displayNameNormalized: candidate.toLowerCase() },
        select: { userId: true },
      });

      if (!clash) {
        return candidate;
      }
    }

    return `${base.slice(0, 40)}_${randomBytes(8).toString('hex')}`;
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
