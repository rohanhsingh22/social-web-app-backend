import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Profile } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOwnProfile(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
    });

    if (!profile) {
      this.logger.warn(`Profile not found for user ${userId}`);
      throw new NotFoundException('PROFILE_NOT_FOUND');
    }

    return profile;
  }

  async updateOwnProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.username) {
      await this.assertUsernameAvailable(userId, dto.username);
    }

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
      dob: dob ?? existing.dob,
      ageGroup: ageGroup ?? existing.ageGroup,
      languages: dto.languages ?? existing.languages,
      characterConfig: characterConfig ?? existing.characterConfig,
    };

    try {
      const updated = await this.prisma.profile.update({
        where: { userId },
        data: {
          ...(dto.username && { username: dto.username }),
          ...(dto.displayName && { displayName: dto.displayName }),
          ...(dto.bio !== undefined && { bio: dto.bio }),
          ...(dob && { dob }),
          ...(ageGroup && { ageGroup }),
          ...(dto.gender !== undefined && { gender: dto.gender }),
          ...(characterConfig && { characterConfig: characterConfig as object }),
          ...(dto.region !== undefined && { region: dto.region }),
          ...(dto.city !== undefined && { city: dto.city }),
          ...(dto.primaryLanguage !== undefined && { primaryLanguage: dto.primaryLanguage }),
          ...(dto.languages && { languages: dto.languages }),
          isComplete: this.isComplete(mergedForCompletion),
        },
      });

      this.logger.log(`Profile updated for user ${userId}`);
      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to update profile for user ${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async getPublicProfile(username: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { username },
      select: {
        userId: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        ageGroup: true,
        gender: true,
        characterConfig: true,
        region: true,
        city: true,
        primaryLanguage: true,
        languages: true,
        isComplete: true,
        createdAt: true,
      },
    });

    if (!profile) {
      this.logger.warn(`Public profile not found for username ${username}`);
      throw new NotFoundException('PROFILE_NOT_FOUND');
    }

    return profile;
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
}
