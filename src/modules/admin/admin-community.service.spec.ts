import { ChannelType } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { AdminReadsService } from './admin-reads.service';
import { AdminService } from './admin.service';

function readsWith(overrides: Record<string, unknown>) {
  return new AdminReadsService({
    channel: { findMany: jest.fn(), findUnique: jest.fn() },
    channelMessage: { count: jest.fn(), groupBy: jest.fn() },
    toli: { findMany: jest.fn() },
    report: { count: jest.fn() },
    notification: { findMany: jest.fn() },
    ...overrides,
  } as unknown as PrismaService);
}

describe('Phase 4 community reads', () => {
  it('flags Toli-linked channels as system-managed', async () => {
    const service = readsWith({
      channel: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c-1',
            name: 'Vector Chat',
            slug: 'toli-vector',
            type: ChannelType.toli,
            visibility: 'private',
            isDefault: false,
            isActive: true,
            sortOrder: 140,
            toliId: 't-1',
            toli: { name: 'Vector' },
            _count: { messages: 7 },
          },
        ]),
      },
      channelMessage: { groupBy: jest.fn().mockResolvedValue([]) },
    });
    const result = await service.listChannels();
    expect(result.channels[0]).toMatchObject({
      slug: 'toli-vector',
      toliName: 'Vector',
      systemManaged: true,
      activeMessages: 7,
    });
  });

  it('throws NOT_FOUND for unknown channel metrics', async () => {
    const service = readsWith({
      channel: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.channelMetrics('missing')).rejects.toThrow('CHANNEL_NOT_FOUND');
  });

  it('returns Toli overview with member counts', async () => {
    const service = readsWith({
      toli: {
        findMany: jest.fn().mockResolvedValue(
          ['Vector', 'Wave', 'Quantum', 'Orbit', 'Flux'].map((name) => ({
            id: `t-${name}`,
            name,
            description: `${name} desc`,
            motto: `${name} motto`,
            _count: { profiles: 3 },
            channels: [{ id: `c-${name}`, slug: `toli-${name.toLowerCase()}`, name: `${name} Chat`, isActive: true }],
          })),
        ),
      },
      channelMessage: { groupBy: jest.fn().mockResolvedValue([]) },
    });
    const result = await service.toliOverview();
    expect(result.tolis).toHaveLength(5);
    expect(result.tolis.map((t) => t.name).sort()).toEqual(
      ['Flux', 'Orbit', 'Quantum', 'Vector', 'Wave'].sort(),
    );
  });

  it('paginates notice history with redacted previews', async () => {
    const rows = [0, 1, 2].map((i) => ({
      id: `n-${i}`,
      title: `Notice ${i}`,
      body: 'x'.repeat(300),
      metadata: { adminId: 'admin-1' },
      readAt: null,
      createdAt: new Date(`2026-09-${20 + i}T10:00:00.000Z`),
      recipient: {
        id: `u-${i}`,
        publicUserId: `HT-000${i}`,
        profile: { displayName: `User ${i}`, username: `user${i}`, avatarUrl: null, toli: null },
      },
    }));
    const service = readsWith({
      notification: { findMany: jest.fn().mockResolvedValue(rows) },
    });
    const page = await service.noticeHistory({ limit: '2' });
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.items[0].bodyPreview?.endsWith('…')).toBe(true);
    expect(page.items[0].adminId).toBe('admin-1');
  });
});

describe('Phase 4 channel protection + dictionary preview', () => {
  const createService = (txOverrides: Record<string, unknown> = {}, prismaOverrides: Record<string, unknown> = {}) => {
    const tx = {
      channel: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      moderationAction: { create: jest.fn() },
      adminAuditEvent: { create: jest.fn() },
      bannedWord: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      ...txOverrides,
    };
    const prisma = {
      bannedWord: { findMany: jest.fn() },
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
      ...prismaOverrides,
    } as unknown as PrismaService;
    const service = new AdminService(
      prisma,
      {} as never,
      {} as never,
      { invalidateChannelMessageCache: jest.fn(), invalidatePublicChannelCache: jest.fn() } as never,
    );
    return { service, tx, prisma };
  };

  it('rejects admin creation of type=toli channels', async () => {
    const { service } = createService();
    await expect(
      service.createChannel('admin-1', { name: 'Fake Toli', slug: 'toli-fake', type: ChannelType.toli }),
    ).rejects.toThrow('TOLI_CHANNEL_MANAGED');
  });

  it('blocks slug/type changes on Toli-linked channels but allows renames', async () => {
    const { service, tx } = createService();
    (tx.channel.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1', toliId: 't-1' });
    await expect(service.updateChannel('admin-1', 'c-1', { slug: 'new-slug' })).rejects.toThrow(
      'TOLI_CHANNEL_PROTECTED',
    );
    (tx.channel.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1', toliId: 't-1' });
    (tx.channel.update as jest.Mock).mockResolvedValue({ id: 'c-1' });
    await expect(
      service.updateChannel('admin-1', 'c-1', { name: 'Vector Chat!' }),
    ).resolves.toEqual({ id: 'c-1' });
  });

  it('previews whole-word matches against active rules', async () => {
    const { service, prisma } = createService();
    (prisma as unknown as { bannedWord: { findMany: jest.Mock } }).bannedWord = {
      findMany: jest.fn().mockResolvedValue([
        { word: 'spam', severity: 'medium' },
        { word: 'scam', severity: 'high' },
      ]),
    };
    const hit = await service.previewBannedWords('This is pure SPAM, beware');
    expect(hit.wouldBlock).toBe(true);
    expect(hit.matches).toEqual([{ word: 'spam', severity: 'medium' }]);
    // Substring should not match (whole-word rule).
    const miss = await service.previewBannedWords('spamming is not the word');
    expect(miss.wouldBlock).toBe(false);
  });
});
