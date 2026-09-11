import { Injectable, Logger } from '@nestjs/common';
import { UserSettings } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';

@Injectable()
export class UserSettingsService {
  private readonly logger = new Logger(UserSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOwnSettings(userId: string): Promise<UserSettings> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      return this.prisma.userSettings.create({
        data: { userId },
      });
    }

    return settings;
  }

  async updateOwnSettings(
    userId: string,
    dto: UpdateUserSettingsDto,
  ): Promise<UserSettings> {
    const existing = await this.prisma.userSettings.findUnique({
      where: { userId },
    });

    const profileVisibility =
      dto.profileVisibility && existing
        ? {
            ...(existing.profileVisibility as Record<string, boolean>),
            ...dto.profileVisibility,
          }
        : dto.profileVisibility;

    try {
      const updated = await this.prisma.userSettings.upsert({
        where: { userId },
        create: {
          userId,
          ...(dto.theme && { theme: dto.theme }),
          ...(dto.accentColor && { accentColor: dto.accentColor }),
          ...(dto.profileVisibility && { profileVisibility: dto.profileVisibility }),
        },
        update: {
          ...(dto.theme && { theme: dto.theme }),
          ...(dto.accentColor && { accentColor: dto.accentColor }),
          ...(profileVisibility && { profileVisibility: profileVisibility as object }),
        },
      });

      this.logger.log(`Settings updated for user ${userId}`);
      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to update settings for user ${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }
}
