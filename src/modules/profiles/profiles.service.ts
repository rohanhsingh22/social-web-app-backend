import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Profile, Prisma } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { ThoughtsService } from '@app/modules/thoughts/thoughts.service';
import { isToliAvatarKeyForToli } from '@app/modules/toli/toli-avatars';
import { ToliService } from '@app/modules/toli/toli.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateProfilePictureDto } from './dto/update-profile-picture.dto';

const profilePictureSelect = {
  profilePictureType: true,
  toliAvatarKey: true,
  avatarUrl: true,
  toli: { select: { id: true, name: true } },
};

type ProfilePictureSource = {
  profilePictureType: 'provider' | 'toli';
  toliAvatarKey: string | null;
  avatarUrl: string | null;
  toli?: { id: string; name: string } | null;
};

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toliService: ToliService,
    private readonly thoughtsService: ThoughtsService,
  ) {}

  async getOwnProfile(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            publicUserId: true,
          },
        },
        toli: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!profile) {
      this.logger.warn(`Profile not found for user ${userId}`);
      throw new NotFoundException('PROFILE_NOT_FOUND');
    }

    const { user, ...profileFields } = profile;

    return {
      ...profileFields,
      publicUserId: user.publicUserId,
      profilePicture: this.toProfilePicture(profile),
    };
  }

  async updateOwnProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.username) {
      await this.assertUsernameAvailable(userId, dto.username);
    }

    const normalizedDisplayName =
      dto.displayName !== undefined
        ? await this.assertDisplayNameAvailable(userId, dto.displayName)
        : undefined;

    const existing = await this.getOwnProfile(userId);

    const characterConfig = dto.characterConfig
      ? {
          ...(existing.characterConfig as Record<string, unknown>),
          ...dto.characterConfig,
        }
      : undefined;

    const dob = dto.dob ? new Date(dto.dob) : undefined;
    const ageGroup = dto.dob ? this.ageGroupFromDob(dto.dob) : undefined;

    const mergedForCompletion = {
      ...existing,
      ...dto,
      displayName: normalizedDisplayName ?? existing.displayName,
      dob: dob ?? existing.dob,
      ageGroup: ageGroup ?? existing.ageGroup,
      languages: dto.languages ?? existing.languages,
      characterConfig: characterConfig ?? existing.characterConfig,
    };

    try {
      await this.prisma.profile.update({
        where: { userId },
        data: {
          ...(dto.username && { username: dto.username }),
          ...(normalizedDisplayName && {
            displayName: normalizedDisplayName,
            displayNameNormalized: normalizedDisplayName.toLowerCase(),
          }),
          ...(dto.bio !== undefined && { bio: dto.bio }),
          ...(dob && { dob }),
          ...(ageGroup && { ageGroup }),
          ...(dto.gender !== undefined && { gender: dto.gender }),
          ...(characterConfig && { characterConfig: characterConfig as object }),
          ...(dto.region !== undefined && { region: dto.region }),
          ...(dto.city !== undefined && { city: dto.city }),
          ...(dto.primaryLanguage !== undefined && { primaryLanguage: dto.primaryLanguage }),
          ...(dto.languages && { languages: dto.languages }),
          ...(dto.interests && { interests: dto.interests }),
          isComplete: this.isComplete(mergedForCompletion),
        },
      });

      this.logger.log(`Profile updated for user ${userId}`);
      return this.getOwnProfile(userId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        this.isDisplayNameConflict(error)
      ) {
        // Check-then-write race lost against a concurrent update.
        throw new ConflictException('DISPLAY_NAME_TAKEN');
      }
      this.logger.error(
        `Failed to update profile for user ${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async getUserProfile(publicUserId: string, viewerId?: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        publicUserId,
      },
      select: {
        id: true,
        publicUserId: true,
        status: true,

        profile: {
          select: {
            username: true,
            displayName: true,
            avatarUrl: true,
            profilePictureType: true,
            toliAvatarKey: true,
            bio: true,
            dob: true,
            ageGroup: true,
            gender: true,
            characterConfig: true,
            region: true,
            city: true,
            primaryLanguage: true,
            languages: true,
            interests: true,
            isComplete: true,
            createdAt: true,
            toli: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },

        settings: {
          select: {
            profileVisibility: true,
          },
        },
      },
    });

    if (!user?.profile) {
      this.logger.warn(
        `Public profile not found for publicUserId ${publicUserId}`,
      );

      throw new NotFoundException('PROFILE_NOT_FOUND');
    }

    // Do not expose profiles of deleted/banned users.
    if (user.status === 'deleted' || user.status === 'banned') {
      throw new NotFoundException('PROFILE_NOT_FOUND');
    }

    if (viewerId && viewerId !== user.id) {
      void this.thoughtsService.recordEvent(viewerId, 'profile_open', undefined, {
        targetUserId: user.id,
      });
    }

    const visibility = this.getProfileVisibility(
      user.settings?.profileVisibility,
    );

    const profile = user.profile;

    return {
      publicUserId: user.publicUserId,

      username: profile.username,
      displayName: profile.displayName,

      avatarUrl: visibility.avatar
        ? profile.avatarUrl
        : null,

      profilePicture: {
        type: profile.profilePictureType,
        avatarUrl:
          profile.profilePictureType === 'provider' && visibility.avatar
            ? profile.avatarUrl
            : null,
        toliAvatarKey:
          profile.profilePictureType === 'toli'
            ? profile.toliAvatarKey
            : null,
        toli: profile.toli,
      },

      toli: profile.toli,

      bio: visibility.bio
        ? profile.bio
        : null,

      dob: visibility.dob
        ? profile.dob
        : null,

      ageGroup: visibility.age
        ? profile.ageGroup
        : null,

      gender: visibility.gender
        ? profile.gender
        : null,

      characterConfig: visibility.avatar
        ? profile.characterConfig
        : null,

      region: visibility.region
        ? profile.region
        : null,

      city: visibility.city
        ? profile.city
        : null,

      primaryLanguage: visibility.primaryLanguage
        ? profile.primaryLanguage
        : null,

      languages: visibility.languages
        ? profile.languages
        : [],

      interests: visibility.languages
        ? profile.interests
        : [],

      isComplete: profile.isComplete,
      createdAt: profile.createdAt,
    };
  }

  async checkDisplayNameAvailability(userId: string, displayName: string) {
    const normalized = this.normalizeDisplayName(displayName);
    const existing = await this.prisma.profile.findUnique({
      where: { displayNameNormalized: normalized.toLowerCase() },
      select: { userId: true },
    });

    return {
      available: !existing || existing.userId === userId,
      displayName: normalized,
    };
  }

  async getProfilePicture(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: profilePictureSelect,
    });

    if (!profile) {
      this.logger.warn(`Profile not found for user ${userId}`);
      throw new NotFoundException('PROFILE_NOT_FOUND');
    }

    return this.toProfilePicture(profile);
  }

  async updateProfilePicture(userId: string, dto: UpdateProfilePictureDto) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: {
        avatarUrl: true,
        toli: { select: { id: true, name: true } },
      },
    });

    if (!profile) {
      this.logger.warn(`Profile not found for user ${userId}`);
      throw new NotFoundException('PROFILE_NOT_FOUND');
    }

    if (dto.type === 'toli') {
      if (!dto.avatarKey) {
        throw new BadRequestException('AVATAR_KEY_REQUIRED');
      }

      if (!profile.toli) {
        throw new BadRequestException('TOLI_REQUIRED');
      }

      if (!isToliAvatarKeyForToli(profile.toli.name, dto.avatarKey)) {
        this.logger.warn(
          `Invalid avatar key ${dto.avatarKey} for Toli ${profile.toli.name}`,
        );
        throw new BadRequestException('INVALID_AVATAR_KEY');
      }

      const updated = await this.prisma.profile.update({
        where: { userId },
        data: {
          profilePictureType: 'toli',
          toliAvatarKey: dto.avatarKey,
        },
        select: profilePictureSelect,
      });

      return this.toProfilePicture(updated);
    }

    if (dto.avatarKey) {
      throw new BadRequestException('AVATAR_KEY_NOT_ALLOWED');
    }

    const updated = await this.prisma.profile.update({
      where: { userId },
      data: {
        profilePictureType: 'provider',
        toliAvatarKey: null,
      },
      select: profilePictureSelect,
    });

    return this.toProfilePicture(updated);
  }

  async selectToli(userId: string, toliId: string | null) {
    const target = toliId ? await this.toliService.findToliById(toliId) : null;

    if (toliId && !target) {
      throw new NotFoundException('TOLI_NOT_FOUND');
    }

    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: {
        toliId: true,
        profilePictureType: true,
        toliAvatarKey: true,
      },
    });

    if (!profile) {
      this.logger.warn(`Profile not found for user ${userId}`);
      throw new NotFoundException('PROFILE_NOT_FOUND');
    }

    if (profile.toliId === (toliId ?? null)) {
      return this.getOwnProfile(userId);
    }

    // Leaving or switching Tolies must never leave a stale Toli avatar
    // active: the picture falls back to provider until a valid avatar
    // for the new Toli is chosen.
    const resetPicture =
      profile.profilePictureType === 'toli' &&
      (target === null ||
        !isToliAvatarKeyForToli(target.name, profile.toliAvatarKey ?? ''));

    await this.prisma.profile.update({
      where: { userId },
      data: {
        toliId: toliId ?? null,
        ...(resetPicture
          ? { profilePictureType: 'provider' as const, toliAvatarKey: null }
          : {}),
      },
    });

    this.logger.log(`Toli ${toliId ?? 'cleared'} for user ${userId}`);
    return this.getOwnProfile(userId);
  }

  private async assertUsernameAvailable(userId: string, username: string) {
    const existing = await this.prisma.profile.findUnique({
      where: { username },
      select: { userId: true },
    });

    if (existing && existing.userId !== userId) {
      this.logger.warn(
        `Username ${username} already taken by user ${existing.userId}`,
      );
      throw new ConflictException('USERNAME_TAKEN');
    }
  }

  private async assertDisplayNameAvailable(
    userId: string,
    displayName: string,
  ): Promise<string> {
    const { available, displayName: normalized } =
      await this.checkDisplayNameAvailability(userId, displayName);

    if (!available) {
      this.logger.warn(`Display name "${normalized}" already taken`);
      throw new ConflictException('DISPLAY_NAME_TAKEN');
    }

    return normalized;
  }

  private toProfilePicture(source: ProfilePictureSource) {
    const isToli = source.profilePictureType === 'toli';

    return {
      type: source.profilePictureType,
      // Toli avatars resolve from the frontend static catalog by key; the
      // backend never fabricates a URL for them.
      avatarUrl: isToli ? null : source.avatarUrl,
      toliAvatarKey: isToli ? source.toliAvatarKey : null,
      toli: source.toli ?? null,
    };
  }

  private normalizeDisplayName(displayName: string): string {
    const normalized = displayName.trim();

    if (!normalized) {
      throw new BadRequestException('DISPLAY_NAME_REQUIRED');
    }

    return normalized;
  }

  private isDisplayNameConflict(
    error: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    const target = error.meta?.target;

    if (typeof target === 'string') {
      return target.includes('display_name');
    }

    if (Array.isArray(target)) {
      return target.some(
        (value) => typeof value === 'string' && value.includes('display_name'),
      );
    }

    return false;
  }

  private ageGroupFromDob(dob: string): string {
    const birthDate = new Date(dob);

    if (Number.isNaN(birthDate.getTime())) {
      this.logger.warn(`Invalid DOB provided: ${dob}`);
      throw new BadRequestException('INVALID_DOB');
    }

    const now = new Date();
    let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
    const monthDelta = now.getUTCMonth() - birthDate.getUTCMonth();
    const beforeBirthday =
      monthDelta < 0 ||
      (monthDelta === 0 && now.getUTCDate() < birthDate.getUTCDate());

    if (beforeBirthday) {
      age -= 1;
    }

    if (age < 13) {
      this.logger.warn(`Profile update rejected for DOB under minimum age: ${dob}`);
      throw new BadRequestException('MINIMUM_AGE_REQUIRED');
    }

    if (age < 18) {
      return '13-17';
    }

    if (age <= 21) {
      return '18-21';
    }

    if (age <= 25) {
      return '22-25';
    }

    if (age <= 35) {
      return '26-35';
    }

    return '36+';
  }

  private isComplete(profile: Pick<
    Profile,
    'username' | 'displayName' | 'ageGroup' | 'region' | 'primaryLanguage'
  >) {
    return Boolean(
      profile.username &&
        profile.displayName &&
        profile.ageGroup &&
        profile.region &&
        profile.primaryLanguage,
    );
  }

  private getProfileVisibility(value: unknown) {
    const visibility =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};

    return {
      avatar: visibility.avatar !== false,
      bio: visibility.bio !== false,
      dob: visibility.dob !== false,
      age: visibility.age !== false,
      gender: visibility.gender !== false,
      region: visibility.region !== false,
      city: visibility.city !== false,
      primaryLanguage:
        visibility.primaryLanguage !== false,
      languages: visibility.languages !== false,
    };
  }
}
