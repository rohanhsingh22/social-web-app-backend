import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReportStatus, UserRole, UserStatus } from '@prisma/client';
import { normalizePublicUserId } from '@app/common/public-user-id';
import { PrismaService } from '@app/core/prisma/prisma.service';
import type { AdminRequestUser } from './auth/admin-auth.guard';
import { AdminAuditQueryDto } from './dto/admin-audit-query.dto';
import { AdminOverviewQueryDto } from './dto/admin-overview-query.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { AdminContentQueryDto } from './dto/admin-content-query.dto';
import { AdminAnalyticsQueryDto } from './dto/admin-analytics-query.dto';

const DEFAULT_OVERVIEW_DAYS = 30;
const MAX_OVERVIEW_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Server-recorded activity types that qualify a user as active. `thought_impression`
 * (passive feed exposure) is excluded so DAU/WAU/MAU reflect deliberate actions,
 * not scrolled-past rows. Staff activity is included and documented in the contract.
 */
const ACTIVE_EVENT_TYPES = [
  'thought_open',
  'thought_like',
  'thought_comment',
  'thought_share',
  'thought_hide',
  'thought_report',
  'profile_open',
  'connection_request',
];

/** UTC bucket key matching Postgres date_trunc('day'|'week') (weeks start Monday). */
function bucketKey(value: Date, trunc: 'day' | 'week'): string {
  const day = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  if (trunc === 'week') {
    const mondayOffset = (day.getUTCDay() + 6) % 7;
    day.setUTCDate(day.getUTCDate() - mondayOffset);
  }
  return day.toISOString().slice(0, 10);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Redacted profile fragment for admin reads. Never identities/emails. */
const adminProfileSelect = {
  username: true,
  displayName: true,
  avatarUrl: true,
  toli: { select: { name: true } },
} as const;

@Injectable()
export class AdminReadsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Overview ----

  async getOverview(admin: AdminRequestUser, query: AdminOverviewQueryDto) {
    const { from, to } = this.parseRange(query.from, query.to);
    const dayEnd = to > new Date() ? new Date() : to;
    const dayStart = new Date(
      Date.UTC(
        dayEnd.getUTCFullYear(),
        dayEnd.getUTCMonth(),
        dayEnd.getUTCDate(),
      ),
    );

    const [
      totalUsers,
      newUsers,
      dau,
      wau,
      mau,
      publicMessages,
      thoughtsCreated,
      pendingReports,
      pendingThoughtReports,
      resolvedReports,
      resolvedThoughtReports,
      activeBans,
      activeMutes,
    ] = await Promise.all([
      this.prisma.user.count({ where: { status: { not: UserStatus.deleted } } }),
      this.prisma.user.count({
        where: { createdAt: { gte: from, lte: to } },
      }),
      this.countActiveUsers(dayStart, dayEnd),
      this.countActiveUsers(new Date(dayEnd.getTime() - 7 * DAY_MS), dayEnd),
      this.countActiveUsers(new Date(dayEnd.getTime() - 30 * DAY_MS), dayEnd),
      this.prisma.channelMessage.count({
        where: { createdAt: { gte: from, lte: to } },
      }),
      this.prisma.thought.count({
        where: { createdAt: { gte: from, lte: to } },
      }),
      this.prisma.report.count({
        where: { status: { in: [ReportStatus.open, ReportStatus.reviewing] } },
      }),
      this.prisma.thoughtReport.count({
        where: { status: { in: [ReportStatus.open, ReportStatus.reviewing] } },
      }),
      this.prisma.report.count({
        where: {
          status: { in: [ReportStatus.resolved, ReportStatus.rejected] },
          reviewedAt: { gte: from, lte: to },
        },
      }),
      this.prisma.thoughtReport.count({
        where: {
          status: { in: [ReportStatus.resolved, ReportStatus.rejected] },
          reviewedAt: { gte: from, lte: to },
        },
      }),
      this.prisma.user.count({ where: { status: UserStatus.banned } }),
      this.prisma.user.count({ where: { status: UserStatus.muted } }),
    ]);

    return {
      totalUsers,
      newUsers,
      dau,
      wau,
      mau,
      publicMessages,
      thoughtsCreated,
      pendingReports: pendingReports + pendingThoughtReports,
      casesResolved: resolvedReports + resolvedThoughtReports,
      activeBans,
      activeMutes,
      // Queue-depth instrumentation lands in Phase 5 ops; null renders as "—",
      // never as a fabricated zero.
      failedJobs: null as number | null,
      from: from.toISOString(),
      to: to.toISOString(),
      // Moderators hold overview.read but not ops.read: the ops-adjacent card is
      // still shown (same shape) so layout stays stable, but the value stays null.
      scoped: admin.role === UserRole.moderator,
    };
  }

  // ---- Users ----

  async listUsers(query: AdminUsersQueryDto) {
    const limit = this.parseLimit(query.limit);
    const cursorDate = query.cursor ? new Date(query.cursor) : null;
    if (query.cursor && Number.isNaN(cursorDate?.getTime())) {
      throw new BadRequestException('INVALID_CURSOR');
    }

    const search = query.search?.trim();
    const publicUserId = search ? normalizePublicUserId(search) : null;
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      ...(search
        ? {
            OR: [
              { profile: { displayName: { contains: search, mode: 'insensitive' as const } } },
              { profile: { username: { contains: search, mode: 'insensitive' as const } } },
              ...(publicUserId ? [{ publicUserId } as const] : []),
            ],
          }
        : {}),
    };

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        publicUserId: true,
        status: true,
        role: true,
        createdAt: true,
        profile: { select: adminProfileSelect },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((row) => ({
        id: row.id,
        publicUserId: row.publicUserId,
        displayName: row.profile?.displayName ?? '—',
        username: row.profile?.username ?? '—',
        role: row.role,
        status: row.status,
        toli: row.profile?.toli?.name ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore
        ? page[page.length - 1].createdAt.toISOString()
        : null,
      hasMore,
    };
  }

  async getUserDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        publicUserId: true,
        status: true,
        role: true,
        createdAt: true,
        profile: { select: adminProfileSelect },
      },
    });
    if (!user) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    const [thoughts, channelMessages, directMessages, openReports, sanctions] =
      await Promise.all([
        this.prisma.thought.count({ where: { authorId: id } }),
        this.prisma.channelMessage.count({ where: { senderId: id } }),
        this.prisma.directMessage.count({ where: { senderId: id } }),
        this.prisma.report.count({
          where: { targetUserId: id, status: { in: [ReportStatus.open, ReportStatus.reviewing] } },
        }),
        this.prisma.moderationAction.count({ where: { targetUserId: id } }),
      ]);

    return {
      id: user.id,
      publicUserId: user.publicUserId,
      displayName: user.profile?.displayName ?? '—',
      username: user.profile?.username ?? '—',
      avatarUrl: user.profile?.avatarUrl ?? null,
      toli: user.profile?.toli?.name ?? null,
      status: user.status,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      activity: { thoughts, channelMessages, directMessages },
      safety: { openReports, sanctions },
    };
  }

  async getUserModerationHistory(id: string) {
    const exists = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    const [moderationActions, auditEvents, reports] = await Promise.all([
      this.prisma.moderationAction.findMany({
        where: { targetUserId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          adminId: true,
          action: true,
          reason: true,
          createdAt: true,
        },
      }),
      this.prisma.adminAuditEvent.findMany({
        where: { targetType: 'user', targetId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          actorId: true,
          actorRole: true,
          action: true,
          reason: true,
          createdAt: true,
        },
      }),
      this.prisma.report.findMany({
        where: { targetUserId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          reason: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
        },
      }),
    ]);

    return { moderationActions, auditEvents, reports };
  }

  // ---- Audit ----

  async listAudit(admin: AdminRequestUser, query: AdminAuditQueryDto) {
    const limit = this.parseLimit(query.limit);
    const { from, to } = this.parseOptionalRange(query.from, query.to);
    const cursorDate = query.cursor ? new Date(query.cursor) : null;
    if (query.cursor && Number.isNaN(cursorDate?.getTime())) {
      throw new BadRequestException('INVALID_CURSOR');
    }

    // Moderators hold audit.read scoped to their own actions; any requested
    // actorId is overridden so they cannot enumerate other staff activity.
    const actorId =
      admin.role === UserRole.moderator ? admin.id : query.actorId;

    const rows = await this.prisma.adminAuditEvent.findMany({
      where: {
        ...(actorId ? { actorId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(from || to
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        actorId: true,
        actorRole: true,
        action: true,
        targetType: true,
        targetId: true,
        reason: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page,
      nextCursor: hasMore
        ? page[page.length - 1].createdAt.toISOString()
        : null,
      hasMore,
    };
  }

  // ---- Content (Phase 3) ----

  async listThoughts(query: AdminContentQueryDto) {
    const limit = this.parseLimit(query.limit);
    const cursorDate = query.cursor ? new Date(query.cursor) : null;
    if (query.cursor && Number.isNaN(cursorDate?.getTime())) {
      throw new BadRequestException('INVALID_CURSOR');
    }
    const search = query.search?.trim();
    const rows = await this.prisma.thought.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        ...(search ? { body: { contains: search, mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        body: true,
        status: true,
        createdAt: true,
        authorId: true,
        author: {
          select: {
            id: true,
            profile: { select: adminProfileSelect },
          },
        },
      },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((row) => ({
        id: row.id,
        body: row.body.length > 280 ? `${row.body.slice(0, 280)}…` : row.body,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        authorId: row.authorId,
        authorDisplayName: row.author?.profile?.displayName ?? '—',
        authorUsername: row.author?.profile?.username ?? '—',
      })),
      nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
      hasMore,
    };
  }

  async listChannelMessages(query: AdminContentQueryDto) {
    const limit = this.parseLimit(query.limit);
    const cursorDate = query.cursor ? new Date(query.cursor) : null;
    if (query.cursor && Number.isNaN(cursorDate?.getTime())) {
      throw new BadRequestException('INVALID_CURSOR');
    }
    const rows = await this.prisma.channelMessage.findMany({
      where: {
        ...(query.channelId ? { channelId: query.channelId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        channelId: true,
        senderId: true,
        body: true,
        status: true,
        createdAt: true,
        channel: { select: { id: true, slug: true, name: true } },
        sender: {
          select: { id: true, profile: { select: adminProfileSelect } },
        },
      },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((row) => ({
        id: row.id,
        channelId: row.channelId,
        channelSlug: row.channel.slug,
        channelName: row.channel.name,
        senderId: row.senderId,
        senderDisplayName: row.sender?.profile?.displayName ?? '—',
        body: row.body.length > 280 ? `${row.body.slice(0, 280)}…` : row.body,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
      hasMore,
    };
  }

  // ---- Channels + Tolies + notices (Phase 4) ----

  async listChannels() {
    const channels = await this.prisma.channel.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 100,
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        visibility: true,
        isDefault: true,
        isActive: true,
        sortOrder: true,
        toliId: true,
        toli: { select: { name: true } },
        _count: { select: { messages: { where: { status: 'active' } } } },
      },
    });
    const recent = await this.prisma.channelMessage.groupBy({
      by: ['channelId'],
      _max: { createdAt: true },
      where: { status: 'active' },
    });
    const lastByChannel = new Map(recent.map((r) => [r.channelId, r._max.createdAt]));
    return {
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        type: c.type,
        visibility: c.visibility,
        isDefault: c.isDefault,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
        toliId: c.toliId,
        toliName: c.toli?.name ?? null,
        systemManaged: c.toliId !== null,
        activeMessages: c._count.messages,
        lastMessageAt: lastByChannel.get(c.id)?.toISOString() ?? null,
      })),
    };
  }

  async channelMetrics(id: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        toliId: true,
        toli: { select: { name: true } },
      },
    });
    if (!channel) {
      throw new NotFoundException('CHANNEL_NOT_FOUND');
    }
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total, active, deleted, weekMessages, channelReports] = await Promise.all([
      this.prisma.channelMessage.count({ where: { channelId: id } }),
      this.prisma.channelMessage.count({ where: { channelId: id, status: 'active' } }),
      this.prisma.channelMessage.count({ where: { channelId: id, status: 'deleted' } }),
      this.prisma.channelMessage.count({
        where: { channelId: id, createdAt: { gte: weekAgo } },
      }),
      this.prisma.report.count({
        where: { channelMessage: { channelId: id } },
      }),
    ]);
    return {
      channel: {
        id: channel.id,
        name: channel.name,
        slug: channel.slug,
        type: channel.type,
        toliName: channel.toli?.name ?? null,
        systemManaged: channel.toliId !== null,
      },
      messages: { total, active, deleted, last7d: weekMessages },
      reports: channelReports,
    };
  }

  async toliOverview() {
    const tolis = await this.prisma.toli.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        motto: true,
        _count: { select: { profiles: true } },
        channels: {
          select: { id: true, slug: true, name: true, isActive: true },
        },
      },
    });
    const counts = await this.prisma.channelMessage.groupBy({
      by: ['channelId'],
      _count: { id: true },
      _max: { createdAt: true },
      where: { status: 'active' },
    });
    const byChannel = new Map(
      counts.map((c) => [c.channelId, { messages: c._count.id, lastAt: c._max.createdAt }]),
    );
    return {
      tolis: tolis.map((t) => {
        const room = t.channels[0] ?? null;
        const stats = room ? byChannel.get(room.id) : undefined;
        return {
          id: t.id,
          name: t.name,
          description: t.description,
          motto: t.motto,
          memberCount: t._count.profiles,
          channel: room,
          activeMessages: stats?.messages ?? 0,
          lastMessageAt: stats?.lastAt?.toISOString() ?? null,
        };
      }),
    };
  }

  async noticeHistory(query: { cursor?: string; limit?: string }) {
    const limit = this.parseLimit(query.limit);
    const cursorDate = query.cursor ? new Date(query.cursor) : null;
    if (query.cursor && Number.isNaN(cursorDate?.getTime())) {
      throw new BadRequestException('INVALID_CURSOR');
    }
    const rows = await this.prisma.notification.findMany({
      where: {
        type: 'legal_notice',
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        title: true,
        body: true,
        metadata: true,
        readAt: true,
        createdAt: true,
        recipient: {
          select: {
            id: true,
            publicUserId: true,
            profile: { select: adminProfileSelect },
          },
        },
      },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((n) => ({
        id: n.id,
        title: n.title,
        bodyPreview: n.body && n.body.length > 200 ? `${n.body.slice(0, 200)}…` : n.body,
        adminId:
          n.metadata && typeof n.metadata === 'object' && 'adminId' in n.metadata
            ? (n.metadata as Record<string, unknown>).adminId
            : null,
        recipientId: n.recipient.id,
        recipientDisplayName: n.recipient.profile?.displayName ?? '—',
        deliveredAt: n.createdAt.toISOString(),
        readAt: n.readAt?.toISOString() ?? null,
      })),
      nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
      hasMore,
    };
  }

  // ---- Analytics (Phase 5) ----

  async getAnalyticsOverview(query: AdminAnalyticsQueryDto) {
    const { from, to } = this.parseAnalyticsRange(query.from, query.to);
    const buckets = await this.buildAnalyticsBuckets(from, to, 'day');
    const totals = {
      registrations: sum(buckets.map((b) => b.registrations)),
      messages: sum(buckets.map((b) => b.messages)),
      thoughts: sum(buckets.map((b) => b.thoughts)),
      reportsCreated: sum(buckets.map((b) => b.reportsCreated)),
      reportsResolved: sum(buckets.map((b) => b.reportsResolved)),
    };
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      granularity: 'day' as const,
      buckets,
      totals,
    };
  }

  async getAnalyticsActivity(query: AdminAnalyticsQueryDto) {
    const { from, to } = this.parseAnalyticsRange(query.from, query.to);
    const granularity = query.granularity === 'week' ? 'week' : 'day';
    const buckets = await this.buildAnalyticsBuckets(from, to, granularity);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      granularity,
      buckets,
    };
  }

  /**
   * UTC-bucketed series via Postgres date_trunc. Seven small indexed range
   * scans (no full-table aggregation); missing buckets are zero-filled so
   * charts render deterministically. Active users per bucket unions the same
   * qualifying event types Phase 2 DAU uses (thought opens/likes/comments/
   * shares/hides/reports, profile opens, connection requests) plus message
   * senders. Staff activity is included, matching overview semantics.
   */
  private async buildAnalyticsBuckets(from: Date, to: Date, trunc: 'day' | 'week') {
    const bucketExpr = trunc === 'week' ? 'week' : 'day';
    const [registrations, messages, thoughts, reportsCreated, reportsResolved, active] =
      await Promise.all([
        this.prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
          SELECT date_trunc(${bucketExpr}, created_at) AS bucket, COUNT(*)::bigint AS count
          FROM users WHERE created_at >= ${from} AND created_at <= ${to}
          GROUP BY 1 ORDER BY 1`,
        this.prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
          SELECT date_trunc(${bucketExpr}, created_at) AS bucket, COUNT(*)::bigint AS count
          FROM channel_messages WHERE created_at >= ${from} AND created_at <= ${to}
          GROUP BY 1 ORDER BY 1`,
        this.prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
          SELECT date_trunc(${bucketExpr}, created_at) AS bucket, COUNT(*)::bigint AS count
          FROM thoughts WHERE created_at >= ${from} AND created_at <= ${to}
          GROUP BY 1 ORDER BY 1`,
        this.prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
          SELECT bucket, SUM(count)::bigint AS count FROM (
            SELECT date_trunc(${bucketExpr}, created_at) AS bucket, COUNT(*) AS count
            FROM reports WHERE created_at >= ${from} AND created_at <= ${to} GROUP BY 1
            UNION ALL
            SELECT date_trunc(${bucketExpr}, created_at) AS bucket, COUNT(*) AS count
            FROM thought_reports WHERE created_at >= ${from} AND created_at <= ${to} GROUP BY 1
          ) s GROUP BY 1 ORDER BY 1`,
        this.prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
          SELECT bucket, SUM(count)::bigint AS count FROM (
            SELECT date_trunc(${bucketExpr}, reviewed_at) AS bucket, COUNT(*) AS count
            FROM reports WHERE reviewed_at >= ${from} AND reviewed_at <= ${to}
              AND status IN ('resolved', 'rejected') GROUP BY 1
            UNION ALL
            SELECT date_trunc(${bucketExpr}, reviewed_at) AS bucket, COUNT(*) AS count
            FROM thought_reports WHERE reviewed_at >= ${from} AND reviewed_at <= ${to}
              AND status IN ('resolved', 'rejected') GROUP BY 1
          ) s GROUP BY 1 ORDER BY 1`,
        this.prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
          SELECT bucket, COUNT(DISTINCT actor)::bigint AS count FROM (
            SELECT date_trunc(${bucketExpr}, created_at) AS bucket, actor_id AS actor
            FROM thought_events
            WHERE created_at >= ${from} AND created_at <= ${to}
              AND type IN ('thought_open','thought_like','thought_comment','thought_share','thought_hide','thought_report','profile_open','connection_request')
            UNION ALL
            SELECT date_trunc(${bucketExpr}, created_at) AS bucket, sender_id AS actor
            FROM channel_messages WHERE created_at >= ${from} AND created_at <= ${to}
            UNION ALL
            SELECT date_trunc(${bucketExpr}, created_at) AS bucket, sender_id AS actor
            FROM direct_messages WHERE created_at >= ${from} AND created_at <= ${to}
          ) s GROUP BY 1 ORDER BY 1`,
      ]);

    const keys = new Set<string>();
    for (const rows of [registrations, messages, thoughts, reportsCreated, reportsResolved, active]) {
      for (const row of rows) keys.add(bucketKey(row.bucket, trunc));
    }
    // Always include the range edges so empty ranges still chart.
    keys.add(bucketKey(from, trunc));
    keys.add(bucketKey(to, trunc));
    const ordered = [...keys].sort();
    const at = (rows: Array<{ bucket: Date; count: bigint }>) => {
      const map = new Map(rows.map((r) => [bucketKey(r.bucket, trunc), Number(r.count)]));
      return (key: string) => map.get(key) ?? 0;
    };
    const getReg = at(registrations);
    const getMsg = at(messages);
    const getThought = at(thoughts);
    const getRepC = at(reportsCreated);
    const getRepR = at(reportsResolved);
    const getActive = at(active);
    return ordered.map((key) => ({
      bucket: key,
      registrations: getReg(key),
      messages: getMsg(key),
      thoughts: getThought(key),
      reportsCreated: getRepC(key),
      reportsResolved: getRepR(key),
      activeUsers: getActive(key),
    }));
  }

  private parseAnalyticsRange(fromRaw?: string, toRaw?: string) {
    const to = toRaw ? new Date(toRaw) : new Date();
    const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 30 * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('INVALID_RANGE');
    }
    if (from > to) {
      throw new BadRequestException('INVALID_RANGE');
    }
    if (to.getTime() - from.getTime() > 92 * DAY_MS) {
      throw new BadRequestException('RANGE_TOO_WIDE');
    }
    return { from, to };
  }

  // ---- internals ----

  private parseRange(fromRaw?: string, toRaw?: string) {
    const to = toRaw ? new Date(toRaw) : new Date();
    const from = fromRaw
      ? new Date(fromRaw)
      : new Date(to.getTime() - DEFAULT_OVERVIEW_DAYS * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('INVALID_RANGE');
    }
    if (from > to) {
      throw new BadRequestException('INVALID_RANGE');
    }
    if (to.getTime() - from.getTime() > MAX_OVERVIEW_DAYS * DAY_MS) {
      throw new BadRequestException('RANGE_TOO_WIDE');
    }
    return { from, to };
  }

  private parseOptionalRange(fromRaw?: string, toRaw?: string) {
    if (!fromRaw && !toRaw) {
      return { from: null as Date | null, to: null as Date | null };
    }
    const { from, to } = this.parseRange(
      fromRaw ?? new Date(0).toISOString(),
      toRaw ?? new Date().toISOString(),
    );
    return { from, to };
  }

  private parseLimit(limitValue?: string) {
    const limit = Number(limitValue ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('INVALID_LIMIT');
    }
    return limit;
  }

  /** Distinct users with qualifying server-recorded activity in [from, to]. */
  private async countActiveUsers(from: Date, to: Date): Promise<number> {
    const [events, channel, dm] = await Promise.all([
      this.prisma.thoughtEvent.findMany({
        where: { type: { in: ACTIVE_EVENT_TYPES }, createdAt: { gte: from, lte: to } },
        select: { actorId: true },
        distinct: ['actorId'],
      }),
      this.prisma.channelMessage.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { senderId: true },
        distinct: ['senderId'],
      }),
      this.prisma.directMessage.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { senderId: true },
        distinct: ['senderId'],
      }),
    ]);
    const ids = new Set<string>();
    for (const row of events) ids.add(row.actorId);
    for (const row of channel) ids.add(row.senderId);
    for (const row of dm) ids.add(row.senderId);
    return ids.size;
  }
}
