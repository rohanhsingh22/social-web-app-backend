import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
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
import { AuthService } from '@app/modules/auth/auth.service';
import { ChannelsService } from '@app/modules/channels/channels.service';
import { AdminActionDto } from './dto/admin-action.dto';
import { CreateBannedWordDto, UpdateBannedWordDto } from './dto/banned-word.dto';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel-admin.dto';
import { LegalNoticeDto } from './dto/legal-notice.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
    private readonly notifications: NotificationsService,
    private readonly channels: ChannelsService,
    @Optional() private readonly authService?: AuthService,
  ) {}

  listReports(status?: ReportStatus, limit?: string) {
    if (status && !Object.values(ReportStatus).includes(status)) {
      throw new BadRequestException('INVALID_REPORT_STATUS');
    }

    return this.reportsService.listForAdmin(status, limit);
  }

  async resolveReport(
    reportId: string,
    adminId: string,
    status: ReportStatus,
    reason?: string,
  ) {
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

      await this.audit(tx, {
        adminId,
        action: 'resolve_report',
        targetType: 'report',
        targetId: reportId,
        reason,
        metadata: { reportId, status },
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

    // Best-effort ordering: the notice leaves via NotificationsService first
    // (external side effect, cannot join the audit transaction). A failed
    // audit write after a sent notice is logged loudly; Phase 2 moves this to
    // an outbox. Known gap, see docs/DB_MIGRATIONS.md.
    await this.prisma.moderationAction.create({
      data: {
        adminId,
        targetUserId: target.id,
        action: 'send_legal_notice',
        metadata: { notificationId: notice.id },
      },
    });
    await this.prisma.adminAuditEvent.create({
      data: {
        actorId: adminId,
        action: 'send_legal_notice',
        targetType: 'user',
        targetId: target.id,
        reason: dto.body.slice(0, 200),
        metadata: { notificationId: notice.id },
      },
    }).catch((error) => {
      this.logger.error(
        `AUDIT_WRITE_FAILED send_legal_notice ${notice.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    });

    return notice;
  }

  async deleteChannelMessage(
    adminId: string,
    messageId: string,
    dto: AdminActionDto,
  ) {
    const message = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.channelMessage
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
        targetUserId: updated.senderId,
        targetMessageId: updated.id,
        targetType: 'channel_message',
        targetId: updated.id,
        reason: dto.reason,
      });

      return updated;
    });

    // Evict cached first-pages so the soft-deleted message disappears
    // immediately instead of lingering until TTL expiry.
    await this.channels.invalidateChannelMessageCache(message.channelId);

    return message;
  }

  async deleteDirectMessage(
    adminId: string,
    messageId: string,
    dto: AdminActionDto,
  ) {
    // Phase 3: nobody browses or deletes unrelated private DMs. The message
    // must be referenced by at least one report; case evidence carries the
    // single reported message only.
    const reported = await this.prisma.report.findFirst({
      where: { targetDirectMessageId: messageId },
      select: { id: true },
    });
    if (!reported) {
      throw new ForbiddenException('DM_ACCESS_DENIED');
    }
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
        targetType: 'direct_message',
        targetId: message.id,
        reason: dto.reason,
      });

      return message;
    });
  }

  async deleteThought(adminId: string, thoughtId: string, dto: AdminActionDto) {
    return this.prisma.$transaction(async (tx) => {
      const thought = await tx.thought
        .update({
          where: { id: thoughtId },
          data: {
            status: MessageStatus.deleted,
            deletedAt: new Date(),
          },
        })
        .catch(() => {
          throw new NotFoundException('THOUGHT_NOT_FOUND');
        });

      await this.audit(tx, {
        adminId,
        action: 'delete_thought',
        targetUserId: thought.authorId,
        targetMessageId: thought.id,
        targetType: 'thought',
        targetId: thought.id,
        reason: dto.reason,
      });

      return thought;
    });
  }

  listThoughtReports(status?: ReportStatus, limitValue?: string) {
    if (status && !Object.values(ReportStatus).includes(status)) {
      throw new BadRequestException('INVALID_REPORT_STATUS');
    }

    const limit = this.parseAdminLimit(limitValue);

    return this.prisma.thoughtReport.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        reporter: {
          select: {
            id: true,
            profile: {
              select: { username: true, displayName: true },
            },
          },
        },
        thought: {
          select: {
            id: true,
            body: true,
            status: true,
            createdAt: true,
            authorId: true,
          },
        },
      },
    });
  }

  async resolveThoughtReport(
    reportId: string,
    adminId: string,
    status: ReportStatus,
    reason?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.thoughtReport
        .update({
          where: { id: reportId },
          data: {
            status,
            reviewedBy: adminId,
            reviewedAt: new Date(),
          },
        })
        .catch(() => {
          throw new NotFoundException('THOUGHT_REPORT_NOT_FOUND');
        });

      await this.audit(tx, {
        adminId,
        action: 'resolve_thought_report',
        targetType: 'thought_report',
        targetId: reportId,
        reason,
        metadata: { thoughtReportId: reportId, status },
      });

      return updated;
    });
  }

  async createChannel(adminId: string, dto: CreateChannelDto) {
    // Phase 4: Toli rooms are seed-managed (one per Toli). Admin creation of
    // type=toli would orphan Toli membership — reject and point at the seed.
    if (dto.type === ChannelType.toli) {
      throw new BadRequestException('TOLI_CHANNEL_MANAGED');
    }
    const data = {
      name: dto.name.trim(),
      slug: dto.slug.trim(),
      type: dto.type,
      visibility: dto.visibility ?? ChannelVisibility.public,
      isDefault: dto.isDefault ?? false,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
    };

    const channel = await this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.channel.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.channel.create({ data });
      await this.audit(tx, {
        adminId,
        action: 'create_channel',
        targetType: 'channel',
        targetId: created.id,
        metadata: { channelId: created.id },
      });

      return created;
    });

    // Local metadata cache only; cross-instance entries expire via TTL.
    this.channels.invalidatePublicChannelCache();

    return channel;
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

    const channel = await this.prisma.$transaction(async (tx) => {
      // Phase 4: Toli-linked channels are protected system resources. Slug or
      // type changes would orphan Toli membership (profile.toliId → channel).
      const existing = await tx.channel.findUnique({
        where: { id: channelId },
        select: { id: true, toliId: true },
      });
      if (!existing) throw new NotFoundException('CHANNEL_NOT_FOUND');
      if (existing.toliId && (dto.slug !== undefined || dto.type !== undefined)) {
        throw new BadRequestException('TOLI_CHANNEL_PROTECTED');
      }
      if (dto.isDefault) {
        await tx.channel.updateMany({
          where: { id: { not: channelId }, isDefault: true },
          data: { isDefault: false },
        });
      }

      const updated = await tx.channel
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
        targetType: 'channel',
        targetId: channelId,
        metadata: { channelId },
      });

      return updated;
    });

    // Visibility/isActive flips must not linger in metadata caches.
    // Local instance is cleared now; other instances expire via TTL.
    this.channels.invalidatePublicChannelCache();

    return channel;
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
        targetType: 'banned_word',
        targetId: bannedWord.id,
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
        targetType: 'banned_word',
        targetId: bannedWordId,
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

    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user
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

      return updated;
    });

    // Ban/revoke must take effect immediately despite the 60s auth cache:
    // drop cached session auth (fail-open, never breaks admin action).
    // Status changes without revoke (mute/unmute/unban) rely on the short
    // TTL for propagation; refresh path always hits DB so new tokens are
    // correct immediately.
    if (options.revokeSessions) {
      await this.authService
        ?.invalidateUserSessionsCache(targetUserId)
        .catch(() => undefined);
    }

    return user;
  }

  async deleteBannedWord(adminId: string, bannedWordId: string) {
    return this.prisma.$transaction(async (tx) => {
      const bannedWord = await tx.bannedWord
        .delete({ where: { id: bannedWordId } })
        .catch(() => {
          throw new NotFoundException('BANNED_WORD_NOT_FOUND');
        });

      await this.audit(tx, {
        adminId,
        action: 'delete_banned_word',
        targetType: 'banned_word',
        targetId: bannedWordId,
        metadata: { bannedWordId },
      });

      return bannedWord;
    });
  }

  /**
   * Phase 4: rule-preview test. Uses the same whole-word matching as the
   * enforcement path (ModerationService.containsBannedWord) against the live
   * active rule set. Banned-word checks read the DB on every message, so rule
   * edits propagate immediately — no cache generation to bump. Read-only: no
   * audit event, usable before saving a new rule.
   */
  async previewBannedWords(text: string) {
    const rules = await this.prisma.bannedWord.findMany({
      where: { isActive: true },
      orderBy: { word: 'asc' },
      select: { word: true, severity: true },
    });
    const matches = rules
      .filter((rule) => this.wouldMatch(text, rule.word))
      .map((rule) => ({ word: rule.word, severity: rule.severity }));
    return { matches, wouldBlock: matches.length > 0, rulesChecked: rules.length };
  }

  private wouldMatch(body: string, word: string) {
    const trimmed = word.trim().toLowerCase();
    if (!trimmed) return false;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\W)${escaped}(?=\\W|$)`, 'i').test(body);
  }

  private parseAdminLimit(limitValue?: string) {
    const limit = Number(limitValue ?? 50);

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('INVALID_LIMIT');
    }

    return limit;
  }

  private normalizeBannedWord(word: string) {
    const normalized = word.trim().toLowerCase();

    if (!normalized) {
      throw new BadRequestException('BANNED_WORD_REQUIRED');
    }

    return normalized;
  }

  /**
   * Atomic dual-write: legacy ModerationAction (compatibility) plus the
   * append-only AdminAuditEvent trail. Runs inside the caller's transaction so
   * an action without its audit record cannot commit.
   */
  private async audit(
    tx: Prisma.TransactionClient,
    data: {
      adminId: string;
      action: string;
      targetUserId?: string;
      targetMessageId?: string;
      targetType?: string;
      targetId?: string;
      reason?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    await tx.moderationAction.create({
      data: {
        adminId: data.adminId,
        action: data.action,
        targetUserId: data.targetUserId,
        targetMessageId: data.targetMessageId,
        reason: data.reason,
        metadata: data.metadata,
      },
    });
    await tx.adminAuditEvent.create({
      data: {
        actorId: data.adminId,
        action: data.action,
        targetType:
          data.targetType ??
          (data.targetUserId
            ? 'user'
            : data.targetMessageId
              ? 'message'
              : null),
        targetId:
          data.targetId ?? data.targetUserId ?? data.targetMessageId ?? null,
        reason: data.reason,
        metadata: data.metadata ?? Prisma.DbNull,
      },
    });
  }
}
