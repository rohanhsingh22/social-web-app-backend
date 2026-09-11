import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MessageStatus, ReportStatus, UserStatus } from '@prisma/client';
import { RateLimitService } from '@app/common/rate-limit.service';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { CreateReportDto } from './dto/create-report.dto';

const REPORT_DAILY_LIMIT = 50;
const DAY_SECONDS = 24 * 60 * 60;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async create(reporterId: string, dto: CreateReportDto) {
    await this.rateLimit.assertAllowed(
      `ratelimit:reports:create:${reporterId}`,
      REPORT_DAILY_LIMIT,
      DAY_SECONDS,
    );

    const target = this.resolveTarget(dto);
    await this.assertTargetExists(reporterId, target);

    return this.prisma.report.create({
      data: {
        reporterId,
        reason: dto.reason,
        details: dto.details?.trim() || null,
        ...target,
      },
    });
  }

  async listForAdmin(status?: ReportStatus, limitValue?: string) {
    const limit = this.parseLimit(limitValue);

    return this.prisma.report.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        reporter: {
          select: {
            id: true,
            profile: { select: this.publicProfileSelect() },
          },
        },
        targetUser: {
          select: {
            id: true,
            status: true,
            profile: { select: this.publicProfileSelect() },
          },
        },
        channelMessage: {
          select: {
            id: true,
            channelId: true,
            senderId: true,
            body: true,
            status: true,
            createdAt: true,
          },
        },
        directMessage: {
          select: {
            id: true,
            conversationId: true,
            senderId: true,
            body: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async resolve(reportId: string, adminId: string, status: ReportStatus) {
    return this.prisma.report.update({
      where: { id: reportId },
      data: {
        status,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });
  }

  private resolveTarget(dto: CreateReportDto) {
    const entries = [
      ['targetUserId', dto.targetUserId],
      ['targetChannelMessageId', dto.targetChannelMessageId],
      ['targetDirectMessageId', dto.targetDirectMessageId],
    ].filter(([, value]) => Boolean(value));

    if (entries.length !== 1) {
      throw new BadRequestException('REPORT_TARGET_REQUIRED');
    }

    return Object.fromEntries(entries) as {
      targetUserId?: string;
      targetChannelMessageId?: string;
      targetDirectMessageId?: string;
    };
  }

  private async assertTargetExists(
    reporterId: string,
    target: {
      targetUserId?: string;
      targetChannelMessageId?: string;
      targetDirectMessageId?: string;
    },
  ) {
    if (target.targetUserId) {
      if (target.targetUserId === reporterId) {
        throw new BadRequestException('CANNOT_REPORT_SELF');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: target.targetUserId },
        select: { id: true, status: true },
      });

      if (!user || user.status === UserStatus.deleted) {
        throw new NotFoundException('USER_NOT_FOUND');
      }

      return;
    }

    if (target.targetChannelMessageId) {
      const message = await this.prisma.channelMessage.findUnique({
        where: { id: target.targetChannelMessageId },
        select: { id: true, status: true },
      });

      if (!message || message.status === MessageStatus.deleted) {
        throw new NotFoundException('MESSAGE_NOT_FOUND');
      }

      return;
    }

    if (target.targetDirectMessageId) {
      const message = await this.prisma.directMessage.findUnique({
        where: { id: target.targetDirectMessageId },
        select: {
          id: true,
          status: true,
          conversation: {
            select: {
              members: {
                where: { userId: reporterId },
                select: { userId: true },
              },
            },
          },
        },
      });

      if (!message || message.status === MessageStatus.deleted) {
        throw new NotFoundException('MESSAGE_NOT_FOUND');
      }

      if (message.conversation.members.length === 0) {
        throw new ForbiddenException('CONVERSATION_ACCESS_DENIED');
      }
    }
  }

  private parseLimit(value?: string) {
    const limit = Number(value ?? 50);

    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException('INVALID_LIMIT');
    }

    return Math.min(limit, 100);
  }

  private publicProfileSelect() {
    return {
      userId: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      ageGroup: true,
      region: true,
      primaryLanguage: true,
      languages: true,
    };
  }
}
