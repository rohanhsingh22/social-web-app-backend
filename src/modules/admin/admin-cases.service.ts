import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReportReason,
  ReportStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import type { AdminRequestUser } from './auth/admin-auth.guard';
import { AdminCasesQueryDto } from './dto/admin-cases-query.dto';
import { AdminCaseResolveDto } from './dto/admin-case-resolve.dto';

export type CaseSourceType =
  | 'user'
  | 'channel_message'
  | 'direct_message'
  | 'thought';

export interface NormalizedCase {
  id: string;
  sourceType: CaseSourceType;
  sourceId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  priority: 'low' | 'medium' | 'high';
  reporterId: string;
  assigneeId: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

const VALID_TYPES: CaseSourceType[] = [
  'user',
  'channel_message',
  'direct_message',
  'thought',
];

function priorityFor(reason: ReportReason): 'low' | 'medium' | 'high' {
  switch (reason) {
    case ReportReason.underage_safety:
    case ReportReason.sexual_content:
    case ReportReason.harassment:
    case ReportReason.hate_or_abuse:
      return 'high';
    case ReportReason.spam:
    case ReportReason.fake_profile:
      return 'medium';
    default:
      return 'low';
  }
}

function parseCaseId(caseId: string): { kind: 'report' | 'thought-report'; id: string } {
  const sep = caseId.indexOf(':');
  if (sep > 0) {
    const kind = caseId.slice(0, sep);
    const id = caseId.slice(sep + 1);
    if ((kind === 'report' || kind === 'thought-report') && id.length >= 1) {
      return { kind, id };
    }
  }
  throw new BadRequestException('INVALID_CASE_ID');
}

const redactedProfileSelect = {
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

/**
 * Phase 3 unified moderation inbox. Normalizes `Report` + `ThoughtReport`
 * without deleting legacy records. Claim/resolve are concurrency-safe:
 * double-claim and double-resolve fail with 409, stale version tokens fail
 * with 409 STALE_CASE_VERSION. Reporter identity is role-gated; DMs surface
 * only as the single reported message.
 */
@Injectable()
export class AdminCasesService {
  constructor(private readonly prisma: PrismaService) {}

  async listCases(admin: AdminRequestUser, query: AdminCasesQueryDto) {
    const limit = this.parseLimit(query.limit);
    const cursorDate = query.cursor ? new Date(query.cursor) : null;
    if (query.cursor && Number.isNaN(cursorDate?.getTime())) {
      throw new BadRequestException('INVALID_CURSOR');
    }
    if (query.type && !VALID_TYPES.includes(query.type as CaseSourceType)) {
      throw new BadRequestException('INVALID_CASE_TYPE');
    }

    const state = query.state;
    const type = query.type as CaseSourceType | undefined;
    const createdLt = cursorDate ? { lt: cursorDate } : undefined;

    const wantReports =
      !type || type === 'user' || type === 'channel_message' || type === 'direct_message';
    const wantThoughtReports = !type || type === 'thought';

    const [reports, thoughtReports] = await Promise.all([
      wantReports
        ? this.prisma.report.findMany({
            where: {
              ...(state ? { status: state } : {}),
              ...(query.assignee ? { reviewedBy: query.assignee } : {}),
              ...(createdLt ? { createdAt: createdLt } : {}),
              ...(type === 'user' ? { targetUserId: { not: null } } : {}),
              ...(type === 'channel_message'
                ? { targetChannelMessageId: { not: null } }
                : {}),
              ...(type === 'direct_message'
                ? { targetDirectMessageId: { not: null } }
                : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
            select: {
              id: true,
              reason: true,
              details: true,
              status: true,
              reporterId: true,
              reviewedBy: true,
              createdAt: true,
              reviewedAt: true,
              targetUserId: true,
              targetChannelMessageId: true,
              targetDirectMessageId: true,
            },
          })
        : Promise.resolve([]),
      wantThoughtReports
        ? this.prisma.thoughtReport.findMany({
            where: {
              ...(state ? { status: state } : {}),
              ...(query.assignee ? { reviewedBy: query.assignee } : {}),
              ...(createdLt ? { createdAt: createdLt } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
            select: {
              id: true,
              thoughtId: true,
              reason: true,
              details: true,
              status: true,
              reporterId: true,
              reviewedBy: true,
              createdAt: true,
              reviewedAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const normalized: NormalizedCase[] = [
      ...reports.map((r) => ({
        id: `report:${r.id}`,
        sourceType: this.reportSourceType(r) as CaseSourceType,
        sourceId:
          r.targetDirectMessageId ??
          r.targetChannelMessageId ??
          r.targetUserId ??
          r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        priority: priorityFor(r.reason),
        reporterId: r.reporterId,
        assigneeId: r.reviewedBy,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
      })),
      ...thoughtReports.map((r) => ({
        id: `thought-report:${r.id}`,
        sourceType: 'thought' as const,
        sourceId: r.thoughtId,
        reason: r.reason,
        details: r.details,
        status: r.status,
        priority: priorityFor(r.reason),
        reporterId: r.reporterId,
        assigneeId: r.reviewedBy,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
      })),
    ];

    // Hide reporter identity from broad list payloads for moderators is
    // handled client-side by role; list keeps reporterId only (no profile).
    void admin;
    normalized.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const hasMore = normalized.length > limit;
    const page = hasMore ? normalized.slice(0, limit) : normalized;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].createdAt : null,
      hasMore,
    };
  }

  async getCaseDetail(admin: AdminRequestUser, caseId: string) {
    const { kind, id } = parseCaseId(caseId);
    const isPrivileged = admin.role === UserRole.owner || admin.role === UserRole.admin;

    if (kind === 'report') {
      const report = await this.prisma.report.findUnique({
        where: { id },
        include: {
          reporter: {
            select: {
              id: true,
              profile: { select: redactedProfileSelect },
            },
          },
          targetUser: {
            select: {
              id: true,
              status: true,
              profile: { select: redactedProfileSelect },
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
              channel: { select: { id: true, slug: true, name: true } },
            },
          },
          directMessage: {
            select: {
              id: true,
              senderId: true,
              body: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });
      if (!report) throw new NotFoundException('CASE_NOT_FOUND');

      const sourceType = this.reportSourceType(report);
      const sourceId =
        report.targetDirectMessageId ??
        report.targetChannelMessageId ??
        report.targetUserId ??
        report.id;

      const history = await this.caseHistory('report', report.id, sourceId, report.targetUserId);

      return {
        id: `report:${report.id}`,
        sourceType,
        sourceId,
        reason: report.reason,
        details: report.details,
        status: report.status,
        priority: priorityFor(report.reason),
        reporter: isPrivileged
          ? {
              id: report.reporter.id,
              displayName: report.reporter.profile?.displayName ?? '—',
              username: report.reporter.profile?.username ?? '—',
            }
          : { id: report.reporter.id },
        reporterId: report.reporter.id,
        assigneeId: report.reviewedBy,
        createdAt: report.createdAt.toISOString(),
        reviewedAt: report.reviewedAt?.toISOString() ?? null,
        reviewedBy: report.reviewedBy,
        version: {
          status: report.status,
          reviewedAt: report.reviewedAt?.toISOString() ?? null,
          reviewedBy: report.reviewedBy,
        },
        evidence: {
          targetUser: report.targetUser,
          channelMessage: report.channelMessage,
          // Minimal DM context: the single reported message only, never the
          // conversation history or other participants.
          directMessage: report.directMessage,
          thought: null,
        },
        history,
      };
    }

    const thoughtReport = await this.prisma.thoughtReport.findUnique({
      where: { id },
      include: {
        reporter: {
          select: { id: true, profile: { select: redactedProfileSelect } },
        },
        thought: {
          select: {
            id: true,
            body: true,
            status: true,
            createdAt: true,
            authorId: true,
            author: {
              select: {
                id: true,
                status: true,
                profile: { select: redactedProfileSelect },
              },
            },
          },
        },
      },
    });
    if (!thoughtReport) throw new NotFoundException('CASE_NOT_FOUND');

    const history = await this.caseHistory(
      'thought-report',
      thoughtReport.id,
      thoughtReport.thoughtId,
      thoughtReport.thought?.authorId ?? null,
    );

    return {
      id: `thought-report:${thoughtReport.id}`,
      sourceType: 'thought' as const,
      sourceId: thoughtReport.thoughtId,
      reason: thoughtReport.reason,
      details: thoughtReport.details,
      status: thoughtReport.status,
      priority: priorityFor(thoughtReport.reason),
      reporter: isPrivileged
        ? {
            id: thoughtReport.reporter.id,
            displayName: thoughtReport.reporter.profile?.displayName ?? '—',
            username: thoughtReport.reporter.profile?.username ?? '—',
          }
        : { id: thoughtReport.reporter.id },
      reporterId: thoughtReport.reporter.id,
      assigneeId: thoughtReport.reviewedBy,
      createdAt: thoughtReport.createdAt.toISOString(),
      reviewedAt: thoughtReport.reviewedAt?.toISOString() ?? null,
      reviewedBy: thoughtReport.reviewedBy,
      version: {
        status: thoughtReport.status,
        reviewedAt: thoughtReport.reviewedAt?.toISOString() ?? null,
        reviewedBy: thoughtReport.reviewedBy,
      },
      evidence: {
        targetUser: null,
        channelMessage: null,
        directMessage: null,
        thought: thoughtReport.thought,
      },
      history,
    };
  }

  async claimCase(adminId: string, caseId: string) {
    const { kind, id } = parseCaseId(caseId);

    if (kind === 'report') {
      return this.prisma.$transaction(async (tx) => {
        const current = await tx.report.findUnique({
          where: { id },
          select: { id: true, status: true, reviewedBy: true, reviewedAt: true },
        });
        if (!current) throw new NotFoundException('CASE_NOT_FOUND');
        if (current.status === ReportStatus.resolved || current.status === ReportStatus.rejected) {
          throw new ConflictException('CASE_ALREADY_RESOLVED');
        }
        if (current.status === ReportStatus.reviewing) {
          // Idempotent retry for the same claimer; conflict for others.
          if (current.reviewedBy === adminId) return this.toCaseId('report', current.id);
          throw new ConflictException('CASE_ALREADY_CLAIMED');
        }
        await tx.report.update({
          where: { id },
          data: {
            status: ReportStatus.reviewing,
            reviewedBy: adminId,
            reviewedAt: new Date(),
          },
        });
        await this.audit(tx, {
          adminId,
          action: 'claim_report',
          targetType: 'report',
          targetId: id,
        });
        return this.toCaseId('report', id);
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.thoughtReport.findUnique({
        where: { id },
        select: { id: true, status: true, reviewedBy: true },
      });
      if (!current) throw new NotFoundException('CASE_NOT_FOUND');
      if (current.status === ReportStatus.resolved || current.status === ReportStatus.rejected) {
        throw new ConflictException('CASE_ALREADY_RESOLVED');
      }
      if (current.status === ReportStatus.reviewing) {
        if (current.reviewedBy === adminId) return this.toCaseId('thought-report', current.id);
        throw new ConflictException('CASE_ALREADY_CLAIMED');
      }
      await tx.thoughtReport.update({
        where: { id },
        data: {
          status: ReportStatus.reviewing,
          reviewedBy: adminId,
          reviewedAt: new Date(),
        },
      });
      await this.audit(tx, {
        adminId,
        action: 'claim_thought_report',
        targetType: 'thought_report',
        targetId: id,
      });
      return this.toCaseId('thought-report', id);
    });
  }

  async resolveCase(adminId: string, caseId: string, dto: AdminCaseResolveDto) {
    if (dto.status !== ReportStatus.resolved && dto.status !== ReportStatus.rejected) {
      throw new BadRequestException('INVALID_RESOLVE_STATUS');
    }
    const { kind, id } = parseCaseId(caseId);
    const expected = dto.expectedReviewedAt ? new Date(dto.expectedReviewedAt) : null;
    if (dto.expectedReviewedAt && Number.isNaN(expected?.getTime())) {
      throw new BadRequestException('INVALID_VERSION');
    }

    if (kind === 'report') {
      return this.prisma.$transaction(async (tx) => {
        const current = await tx.report.findUnique({
          where: { id },
          select: { id: true, status: true, reviewedAt: true },
        });
        if (!current) throw new NotFoundException('CASE_NOT_FOUND');
        if (current.status === ReportStatus.resolved || current.status === ReportStatus.rejected) {
          throw new ConflictException('CASE_ALREADY_RESOLVED');
        }
        if (expected && current.reviewedAt) {
          if (Math.abs(current.reviewedAt.getTime() - expected.getTime()) > 1000) {
            throw new ConflictException('STALE_CASE_VERSION');
          }
        } else if (expected && !current.reviewedAt && dto.expectedReviewedAt) {
          throw new ConflictException('STALE_CASE_VERSION');
        }
        const updated = await tx.report.update({
          where: { id },
          data: {
            status: dto.status,
            reviewedBy: adminId,
            reviewedAt: new Date(),
          },
        });
        await this.audit(tx, {
          adminId,
          action: 'resolve_report',
          targetType: 'report',
          targetId: id,
          reason: dto.reason,
          metadata: { status: dto.status },
        });
        return updated;
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.thoughtReport.findUnique({
        where: { id },
        select: { id: true, status: true, reviewedAt: true },
      });
      if (!current) throw new NotFoundException('CASE_NOT_FOUND');
      if (current.status === ReportStatus.resolved || current.status === ReportStatus.rejected) {
        throw new ConflictException('CASE_ALREADY_RESOLVED');
      }
      if (expected && current.reviewedAt) {
        if (Math.abs(current.reviewedAt.getTime() - expected.getTime()) > 1000) {
          throw new ConflictException('STALE_CASE_VERSION');
        }
      } else if (expected && !current.reviewedAt && dto.expectedReviewedAt) {
        throw new ConflictException('STALE_CASE_VERSION');
      }
      const updated = await tx.thoughtReport.update({
        where: { id },
        data: {
          status: dto.status,
          reviewedBy: adminId,
          reviewedAt: new Date(),
        },
      });
      await this.audit(tx, {
        adminId,
        action: 'resolve_thought_report',
        targetType: 'thought_report',
        targetId: id,
        reason: dto.reason,
        metadata: { status: dto.status },
      });
      return updated;
    });
  }

  private reportSourceType(report: {
    targetUserId?: string | null;
    targetChannelMessageId?: string | null;
    targetDirectMessageId?: string | null;
  }): CaseSourceType {
    if (report.targetDirectMessageId) return 'direct_message';
    if (report.targetChannelMessageId) return 'channel_message';
    if (report.targetUserId) return 'user';
    return 'user';
  }

  private toCaseId(kind: 'report' | 'thought-report', id: string) {
    return { caseId: `${kind}:${id}` };
  }

  private async caseHistory(
    kind: 'report' | 'thought-report',
    reportId: string,
    sourceId: string,
    targetUserId: string | null,
  ) {
    const [moderationActions, auditEvents] = await Promise.all([
      this.prisma.moderationAction.findMany({
        where: {
          OR: [
            { targetMessageId: sourceId },
            ...(targetUserId ? [{ targetUserId }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          adminId: true,
          action: true,
          reason: true,
          createdAt: true,
        },
      }),
      this.prisma.adminAuditEvent.findMany({
        where: {
          OR: [{ targetId: reportId }, { targetId: sourceId }],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          actorId: true,
          actorRole: true,
          action: true,
          reason: true,
          createdAt: true,
        },
      }),
    ]);
    void kind;
    return { moderationActions, auditEvents };
  }

  private parseLimit(limitValue?: string) {
    const limit = Number(limitValue ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('INVALID_LIMIT');
    }
    return limit;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    data: {
      adminId: string;
      action: string;
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
        reason: data.reason,
        metadata: data.metadata,
      },
    });
    await tx.adminAuditEvent.create({
      data: {
        actorId: data.adminId,
        action: data.action,
        targetType: data.targetType ?? null,
        targetId: data.targetId ?? null,
        reason: data.reason,
        metadata: data.metadata ?? Prisma.DbNull,
      },
    });
  }

  /** Guards destructive DM access: only a DM referenced by a report may be touched. */
  async assertReportedDirectMessage(messageId: string) {
    const report = await this.prisma.report.findFirst({
      where: { targetDirectMessageId: messageId },
      select: { id: true },
    });
    if (!report) {
      throw new ForbiddenException('DM_ACCESS_DENIED');
    }
  }
}
