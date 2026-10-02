import { ReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { AdminCasesService } from './admin-cases.service';

const owner = { id: 'owner-1', status: 'active', role: UserRole.owner, sessionId: 's-1' } as never;
const moderator = { id: 'mod-1', status: 'active', role: UserRole.moderator, sessionId: 's-2' } as never;

const iso = (day: string) => new Date(`${day}T10:00:00.000Z`);

describe('AdminCasesService', () => {
  it('merges report sources, derives priority, and paginates by cursor', async () => {
    const reports = [
      {
        id: 'r-new',
        reason: 'harassment',
        details: null,
        status: ReportStatus.open,
        reporterId: 'u-1',
        reviewedBy: null,
        createdAt: iso('2026-09-26'),
        reviewedAt: null,
        targetUserId: null,
        targetChannelMessageId: 'm-1',
        targetDirectMessageId: null,
      },
      {
        id: 'r-old',
        reason: 'spam',
        details: null,
        status: ReportStatus.open,
        reporterId: 'u-2',
        reviewedBy: null,
        createdAt: iso('2026-09-20'),
        reviewedAt: null,
        targetUserId: 'u-9',
        targetChannelMessageId: null,
        targetDirectMessageId: null,
      },
    ];
    const thoughtReports = [
      {
        id: 't-mid',
        thoughtId: 'th-1',
        reason: 'other',
        details: null,
        status: ReportStatus.reviewing,
        reporterId: 'u-3',
        reviewedBy: 'mod-1',
        createdAt: iso('2026-09-24'),
        reviewedAt: iso('2026-09-25'),
      },
    ];
    const prisma = {
      report: { findMany: jest.fn().mockResolvedValue(reports) },
      thoughtReport: { findMany: jest.fn().mockResolvedValue(thoughtReports) },
    } as unknown as PrismaService;
    const service = new AdminCasesService(prisma);

    const page = await service.listCases(owner, { limit: '2' });
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.items[0].id).toBe('report:r-new');
    expect(page.items[0].priority).toBe('high');
    expect(page.items[0].sourceType).toBe('channel_message');
    expect(page.nextCursor).toBe(iso('2026-09-24').toISOString());

    const second = await service.listCases(owner, {
      limit: '2',
      cursor: page.nextCursor ?? undefined,
    });
    const reportWhere = (prisma.report.findMany as jest.Mock).mock.calls[1][0].where;
    expect(reportWhere.createdAt).toEqual({ lt: new Date(page.nextCursor as string) });
    expect(second).toBeDefined();
  });

  it('rejects invalid case types and limits', async () => {
    const prisma = {
      report: { findMany: jest.fn() },
      thoughtReport: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const service = new AdminCasesService(prisma);
    await expect(service.listCases(owner, { type: 'dm_dump' })).rejects.toThrow(
      'INVALID_CASE_TYPE',
    );
    await expect(service.listCases(owner, { limit: '999' })).rejects.toThrow('INVALID_LIMIT');
  });

  it('redacts reporter profiles for moderators', async () => {
    const report = {
      id: 'r-1',
      reason: 'spam',
      details: null,
      status: ReportStatus.open,
      reporter: { id: 'rep-1', profile: { displayName: 'Rep', username: 'rep' } },
      reporterId: 'rep-1',
      reviewedBy: null,
      createdAt: iso('2026-09-26'),
      reviewedAt: null,
      targetUserId: 'u-9',
      targetChannelMessageId: null,
      targetDirectMessageId: null,
      targetUser: null,
      channelMessage: null,
      directMessage: null,
    };
    const prisma = {
      report: { findUnique: jest.fn().mockResolvedValue(report) },
      thoughtReport: { findUnique: jest.fn() },
      moderationAction: { findMany: jest.fn().mockResolvedValue([]) },
      adminAuditEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const service = new AdminCasesService(prisma);
    const modView = await service.getCaseDetail(moderator, 'report:r-1');
    expect(modView.reporter).toEqual({ id: 'rep-1' });
    const ownerView = await service.getCaseDetail(owner, 'report:r-1');
    expect(ownerView.reporter).toMatchObject({ id: 'rep-1', displayName: 'Rep' });
  });

  it('claim is idempotent for the same moderator but conflicts for others', async () => {
    const tx = {
      report: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      thoughtReport: { findUnique: jest.fn(), update: jest.fn() },
      moderationAction: { create: jest.fn().mockResolvedValue({}) },
      adminAuditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const service = new AdminCasesService(prisma);

    tx.report.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      status: ReportStatus.reviewing,
      reviewedBy: 'mod-1',
    });
    await expect(service.claimCase('mod-1', 'report:r-1')).resolves.toEqual({
      caseId: 'report:r-1',
    });

    tx.report.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      status: ReportStatus.reviewing,
      reviewedBy: 'mod-2',
    });
    await expect(service.claimCase('mod-1', 'report:r-1')).rejects.toThrow(
      'CASE_ALREADY_CLAIMED',
    );

    tx.report.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      status: ReportStatus.resolved,
      reviewedBy: 'mod-2',
    });
    await expect(service.claimCase('mod-1', 'report:r-1')).rejects.toThrow(
      'CASE_ALREADY_RESOLVED',
    );
  });

  it('resolve requires resolved/rejected and guards stale versions', async () => {
    const tx = {
      report: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'r-1' }),
      },
      thoughtReport: { findUnique: jest.fn(), update: jest.fn() },
      moderationAction: { create: jest.fn().mockResolvedValue({}) },
      adminAuditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const service = new AdminCasesService(prisma);

    await expect(
      service.resolveCase('mod-1', 'report:r-1', {
        status: ReportStatus.reviewing,
        reason: 'x',
      }),
    ).rejects.toThrow('INVALID_RESOLVE_STATUS');

    tx.report.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      status: ReportStatus.resolved,
      reviewedAt: null,
    });
    await expect(
      service.resolveCase('mod-1', 'report:r-1', { status: ReportStatus.resolved, reason: 'done' }),
    ).rejects.toThrow('CASE_ALREADY_RESOLVED');

    tx.report.findUnique.mockResolvedValueOnce({
      id: 'r-1',
      status: ReportStatus.reviewing,
      reviewedAt: iso('2026-09-26'),
    });
    await expect(
      service.resolveCase('mod-1', 'report:r-1', {
        status: ReportStatus.resolved,
        reason: 'done',
        expectedReviewedAt: iso('2026-09-20').toISOString(),
      }),
    ).rejects.toThrow('STALE_CASE_VERSION');
  });

  it('blocks unreported DM access', async () => {
    const prisma = {
      report: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new AdminCasesService(prisma);
    await expect(service.assertReportedDirectMessage('dm-1')).rejects.toThrow(
      'DM_ACCESS_DENIED',
    );
  });
});
