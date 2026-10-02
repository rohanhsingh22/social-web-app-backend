import { UserRole } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { AdminReadsService } from './admin-reads.service';

const owner = { id: 'owner-1', status: 'active', role: 'owner' as const, sessionId: 's-1' };
const moderator = { id: 'mod-1', status: 'active', role: 'moderator' as const, sessionId: 's-2' };

const createPrisma = (overrides: Record<string, unknown> = {}) => {
  const zero = jest.fn().mockResolvedValue(0);
  const empty = jest.fn().mockResolvedValue([]);
  return {
    user: { count: zero, findMany: empty, findUnique: jest.fn() },
    thoughtEvent: { findMany: empty },
    channelMessage: { findMany: empty, count: zero },
    directMessage: { findMany: empty, count: zero },
    thought: { count: zero },
    report: { count: zero, findMany: empty },
    thoughtReport: { count: zero },
    moderationAction: { count: zero, findMany: empty },
    adminAuditEvent: { findMany: empty },
    ...overrides,
  } as unknown as PrismaService;
};

describe('AdminReadsService', () => {
  it('sums report sources and leaves queue depth null (Phase 5)', async () => {
    const prisma = createPrisma({
      report: { count: jest.fn().mockResolvedValue(4) },
      thoughtReport: { count: jest.fn().mockResolvedValue(3) },
    });
    const service = new AdminReadsService(prisma);
    const overview = await service.getOverview(owner, {});
    expect(overview.pendingReports).toBe(7);
    expect(overview.failedJobs).toBeNull();
    expect(overview.scoped).toBe(false);
    expect(overview.from).toBeDefined();
    expect(overview.to).toBeDefined();
  });

  it('marks moderator overview as scoped', async () => {
    const service = new AdminReadsService(createPrisma());
    const overview = await service.getOverview(moderator, {});
    expect(overview.scoped).toBe(true);
  });

  it('rejects over-wide overview ranges', async () => {
    const service = new AdminReadsService(createPrisma());
    await expect(
      service.getOverview(owner, { from: '2020-01-01', to: '2026-09-27' }),
    ).rejects.toThrow('RANGE_TOO_WIDE');
  });

  it('paginates users with cursor and redacts identities', async () => {
    const rows = [0, 1, 2].map((index) => ({
      id: `u-${index}`,
      publicUserId: `HRT-000${index}`,
      status: 'active',
      role: UserRole.user,
      createdAt: new Date(`2026-09-${20 + index}T10:00:00.000Z`),
      profile: { displayName: `User ${index}`, username: `user${index}`, avatarUrl: null, toli: null },
    }));
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = createPrisma({ user: { findMany } });
    const service = new AdminReadsService(prisma);
    const page = await service.listUsers({ limit: '2' });
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('2026-09-21T10:00:00.000Z');
    // Redaction: no identities/emails in the select clause.
    const select = findMany.mock.calls[0][0].select as Record<string, unknown>;
    expect(select).not.toHaveProperty('identities');
    expect(JSON.stringify(select)).not.toContain('providerEmail');
  });

  it('throws for invalid user limits', async () => {
    const service = new AdminReadsService(createPrisma());
    await expect(service.listUsers({ limit: '999' })).rejects.toThrow('INVALID_LIMIT');
  });

  it('throws NOT_FOUND for unknown user detail', async () => {
    const prisma = createPrisma({
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const service = new AdminReadsService(prisma);
    await expect(service.getUserDetail('missing')).rejects.toThrow('USER_NOT_FOUND');
  });

  it('scopes moderators to their own audit trail', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = createPrisma({ adminAuditEvent: { findMany } });
    const service = new AdminReadsService(prisma);
    await service.listAudit(moderator, { actorId: '00000000-0000-0000-0000-000000000001' });
    expect(findMany.mock.calls[0][0].where.actorId).toBe('mod-1');
  });

  it('lets owners filter audit by any actor', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = createPrisma({ adminAuditEvent: { findMany } });
    const service = new AdminReadsService(prisma);
    await service.listAudit(owner, { actorId: '00000000-0000-0000-0000-000000000001' });
    expect(findMany.mock.calls[0][0].where.actorId).toBe(
      '00000000-0000-0000-0000-000000000001',
    );
  });
});
