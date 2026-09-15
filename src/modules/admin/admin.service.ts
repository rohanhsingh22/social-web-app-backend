import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BannedWordSeverity,
  ChannelType,
  ChannelVisibility,
  MessageStatus,
  Prisma,
  ReportStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { NotificationsService } from '@app/modules/notifications/notifications.service';
import { ReportsService } from '@app/modules/reports/reports.service';
import { AdminActionDto } from './dto/admin-action.dto';
import { CreateBannedWordDto, UpdateBannedWordDto } from './dto/banned-word.dto';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel-admin.dto';
import { LegalNoticeDto } from './dto/legal-notice.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
    private readonly notifications: NotificationsService,
  ) {}

  listReports(status?: ReportStatus, limit?: string) {
    if (status && !Object.values(ReportStatus).includes(status)) {
      throw new BadRequestException('INVALID_REPORT_STATUS');
    }

    return this.reportsService.listForAdmin(status, limit);
  }

  async resolveReport(reportId: string, adminId: string, status: ReportStatus) {
    const report = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.report.update({
        where: { id: reportId },
        data: {
          status,
          reviewedBy: adminId,
          reviewedAt: new Date(),
        },
      }).catch(() => {
        throw new NotFoundException('REPORT_NOT_FOUND');
      });

      await tx.moderationAction.create({
        data: {
          adminId,
          action: 'resolve_report',
          metadata: { reportId, status },
        },
      });

      return updated;
    });

    return report;
  }

  muteUser(adminId: string, targetUserId: string, dto: AdminActionDto) {
    return this.updateUserStatus(adminId, targetUserId, UserStatus.muted, {
      action: 'mute_user',
      reason: dto.reason,
    });
  }

  unmuteUser(adminId: string, targetUserId: string, dto: AdminActionDto) {
    return this.updateUserStatus(adminId, targetUserId, UserStatus.active, {
      action: 'unmute_user',
      reason: dto.reason,
    });
  }

  banUser(adminId: string, targetUserId: string, dto: AdminActionDto) {
    return this.updateUserStatus(adminId, targetUserId, UserStatus.banned, {
      action: 'ban_user',
      reason: dto.reason,
      revokeSessions: true,
    });
  }

  unbanUser(adminId: string, targetUserId: string, dto: AdminActionDto) {
    return this.updateUserStatus(adminId, targetUserId, UserStatus.active, {
      action: 'unban_user',
      reason: dto.reason,
    });
  }

  async sendLegalNotice(adminId: string, dto: LegalNoticeDto) {
    const target = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, status: true },
    });

    if (!target || target.status === UserStatus.deleted) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    const notice = await this.notifications.legalNotice(target.id, {
      title: dto.title,
      body: dto.body,
      adminId,
    });

    await this.prisma.moderationAction.create({
      data: {
        adminId,
        targetUserId: target.id,
        action: 'send_legal_notice',
        metadata: { notificationId: notice.id },
      },
    });

    return notice;
  }

  async deleteChannelMessage(
    adminId: string,
    messageId: string,
    dto: AdminActionDto,
  ) {    return this.prisma.$transaction(async (tx) => {
      const message = await tx.channelMessage
        .update({
          where: { id: messageId },
          data: {
            status: MessageStatus.deleted,
            deletedAt: new Date(),
            deletedBy: adminId,
          },
        })
        .catch(() => {
          throw new NotFoundException('MESSAGE_NOT_FOUND');
        });

      await this.audit(tx, {
        adminId,
        action: 'delete_channel_message',
        targetUserId: message.senderId,
        targetMessageId: message.id,
        reason: dto.reason,
      });

      return message;
    });
  }

  async deleteDirectMessage(
    adminId: string,
    messageId: string,
    dto: AdminActionDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.directMessage
        .update({
          where: { id: messageId },
          data: {
            status: MessageStatus.deleted,
            deletedAt: new Date(),
          },
        })
        .catch(() => {
          throw new NotFoundException('MESSAGE_NOT_FOUND');
        });

      await this.audit(tx, {
        adminId,
        action: 'delete_direct_message',
        targetUserId: message.senderId,
        targetMessageId: message.id,
        reason: dto.reason,
      });

      return message;
    });
  }

  async createChannel(adminId: string, dto: CreateChannelDto) {
    const data = {
      name: dto.name.trim(),
      slug: dto.slug.trim(),
      type: dto.type,
      visibility: dto.visibility ?? ChannelVisibility.public,
      isDefault: dto.isDefault ?? false,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
    };

    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.channel.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      const channel = await tx.channel.create({ data });
      await this.audit(tx, {
        adminId,
        action: 'create_channel',
        metadata: { channelId: channel.id },
      });

      return channel;
    });
  }

  async updateChannel(adminId: string, channelId: string, dto: UpdateChannelDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('CHANNEL_UPDATE_REQUIRED');
    }

    const data: {
      name?: string;
      slug?: string;
      type?: ChannelType;
      visibility?: ChannelVisibility;
      isDefault?: boolean;
      isActive?: boolean;
      sortOrder?: number;
    } = {
      name: dto.name?.trim(),
      slug: dto.slug?.trim(),
      type: dto.type,
      visibility: dto.visibility,
      isDefault: dto.isDefault,
      isActive: dto.isActive,
      sortOrder: dto.sortOrder,
    };

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.channel.updateMany({
          where: { id: { not: channelId }, isDefault: true },
          data: { isDefault: false },
        });
      }

      const channel = await tx.channel
        .update({
          where: { id: channelId },
          data,
        })
        .catch(() => {
          throw new NotFoundException('CHANNEL_NOT_FOUND');
        });

      await this.audit(tx, {
        adminId,
        action: 'update_channel',
        metadata: { channelId },
      });

      return channel;
    });
  }

  listBannedWords() {
    return this.prisma.bannedWord.findMany({
      orderBy: [{ isActive: 'desc' }, { word: 'asc' }],
    });
  }

  async createBannedWord(adminId: string, dto: CreateBannedWordDto) {
    const word = this.normalizeBannedWord(dto.word);

    return this.prisma.$transaction(async (tx) => {
      const bannedWord = await tx.bannedWord.create({
        data: {
          word,
          severity: dto.severity ?? BannedWordSeverity.medium,
        },
      });

      await this.audit(tx, {
        adminId,
        action: 'create_banned_word',
        metadata: { bannedWordId: bannedWord.id },
      });

      return bannedWord;
    });
  }

  async updateBannedWord(
    adminId: string,
    bannedWordId: string,
    dto: UpdateBannedWordDto,
  ) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('BANNED_WORD_UPDATE_REQUIRED');
    }

    return this.prisma.$transaction(async (tx) => {
      const bannedWord = await tx.bannedWord
        .update({
          where: { id: bannedWordId },
          data: {
            word: dto.word ? this.normalizeBannedWord(dto.word) : undefined,
            severity: dto.severity,
            isActive: dto.isActive,
          },
        })
        .catch(() => {
          throw new NotFoundException('BANNED_WORD_NOT_FOUND');
        });

      await this.audit(tx, {
        adminId,
        action: 'update_banned_word',
        metadata: { bannedWordId },
      });

      return bannedWord;
    });
  }

  private async updateUserStatus(
    adminId: string,
    targetUserId: string,
    status: UserStatus,
    options: {
      action: string;
      reason?: string;
      revokeSessions?: boolean;
    },
  ) {
    if (adminId === targetUserId) {
      throw new BadRequestException('CANNOT_MODERATE_SELF');
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user
        .update({
          where: { id: targetUserId },
          data: { status },
          select: { id: true, status: true, role: true, updatedAt: true },
        })
        .catch(() => {
          throw new NotFoundException('USER_NOT_FOUND');
        });

      if (options.revokeSessions) {
        await tx.session.updateMany({
          where: {
            userId: targetUserId,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      }

      await this.audit(tx, {
        adminId,
        action: options.action,
        targetUserId,
        reason: options.reason,
      });

      return user;
    });
  }

  private normalizeBannedWord(word: string) {
    const normalized = word.trim().toLowerCase();

    if (!normalized) {
      throw new BadRequestException('BANNED_WORD_REQUIRED');
    }

    return normalized;
  }

  private audit(
    tx: Prisma.TransactionClient,
    data: {
      adminId: string;
      action: string;
      targetUserId?: string;
      targetMessageId?: string;
      reason?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    return tx.moderationAction.create({ data });
  }
}
