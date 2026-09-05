import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Profile } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwnProfile(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('PROFILE_NOT_FOUND');
    }

    return profile;
  }

  async updateOwnProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.username) {
      await this.assertUsernameAvailable(userId, dto.username);
    }

    const nextData = {
      ...dto,
      dob: dto.dob ? new Date(dto.dob) : undefined,
      ageGroup: dto.dob ? this.ageGroupFromDob(dto.dob) : undefined,
    };

    const existing = await this.getOwnProfile(userId);
    const merged = {
      ...existing,
      ...nextData,
      dob: nextData.dob ?? existing.dob,
      ageGroup: nextData.ageGroup ?? existing.ageGroup,
      languages: nextData.languages ?? existing.languages,
    };

    return this.prisma.profile.update({
      where: { userId },
      data: {
        ...nextData,
        isComplete: this.isComplete(merged),
      },
    });
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
        region: true,
        city: true,
        primaryLanguage: true,
        languages: true,
        isComplete: true,
        createdAt: true,
      },
    });

    if (!profile) {
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
      throw new ConflictException('USERNAME_TAKEN');
    }
  }

  private ageGroupFromDob(dob: string): string {
    const birthDate = new Date(dob);

    if (Number.isNaN(birthDate.getTime())) {
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
