import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { ModerationService } from '@app/modules/moderation/moderation.service';
import { ThoughtsRankingService } from './thoughts-ranking.service';
import { ThoughtsService } from './thoughts.service';

describe('ThoughtsService', () => {
  const activeUser = { id: 'user-1', status: 'active', role: 'user' } as const;

  const authorRow = (overrides = {}) => ({
    id: 'author-1',
    publicUserId: 'HT-AAAAAAAA',
    profile: {
      username: 'author_one',
      displayName: 'Author One',
      avatarUrl: null,
      profilePictureType: 'provider',
      toliAvatarKey: null,
      interests: ['music'],
      toliId: null,
      toli: null,
    },
    ...overrides,
  });

  const thoughtRow = (overrides = {}) => ({
    id: 'thought-1',
    body: 'Hello thoughts',
    status: 'active',
    createdAt: new Date('2026-09-14T11:00:00.000Z'),
    author: authorRow(),
    _count: { likes: 2, comments: 1, shares: 0 },
    ...overrides,
  });

  const createService = () => {
    const thought = { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() };
    const thoughtLike = { create: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
    const thoughtShare = { create: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
    const thoughtHide = { create: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
    const thoughtReport = { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
    const thoughtComment = { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
    const thoughtEvent = { create: jest.fn(), createMany: jest.fn() };
    const block = { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) };
    const profile = { findUnique: jest.fn().mockResolvedValue(null) };
    const connection = { findMany: jest.fn().mockResolvedValue([]) };
    const prisma = {
      thought,
      thoughtLike,
      thoughtShare,
      thoughtHide,
      thoughtReport,
      thoughtComment,
      thoughtEvent,
      block,
      profile,
      connection,
      userSettings: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const moderation = {
      assertMessageAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as ModerationService;
    const ranking = {
      rank: jest.fn((items: unknown[]) =>
        (items as { id: string }[]).map((thought) => ({ thought, score: 1 })),
      ),
      // Faithful to the real implementation: never more than `limit` picks.
      applyAuthorDiversity: jest.fn((items: unknown[], limit: number) =>
        (items as unknown[]).slice(0, limit),
      ),
    } as unknown as ThoughtsRankingService;
    const eventsQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    return {
      service: new ThoughtsService(prisma, moderation, ranking),
      prisma,
      thought,
      thoughtLike,
      thoughtShare,
      thoughtHide,
      thoughtReport,
      thoughtComment,
      thoughtEvent,
      block,
      profile,
      connection,
      moderation,
      ranking,
      eventsQueue,
    };
  };

  it('creates a thought with trimmed text and moderation', async () => {
    const { service, thought, moderation } = createService();
    thought.create.mockResolvedValue(thoughtRow());

    const result = await service.createThought(
      { ...activeUser },
      '  Hello thoughts  ',
    );

    expect(moderation.assertMessageAllowed).toHaveBeenCalledWith(
      'Hello thoughts',
    );
    expect(thought.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { authorId: 'user-1', body: 'Hello thoughts' },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'thought-1',
        counts: { likes: 2, comments: 1, shares: 0 },
        viewer: { liked: false, shared: false, hidden: false },
      }),
    );
  });

  it('rejects blank thoughts and inactive authors', async () => {
    const { service } = createService();

    await expect(
      service.createThought({ ...activeUser }, '   '),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createThought(
        { id: 'user-2', status: 'muted', role: 'user' },
        'hello',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('hides blocked authors behind not-found', async () => {
    const { service, thought, block } = createService();
    thought.findUnique.mockResolvedValue({
      id: 'thought-1',
      authorId: 'author-1',
      status: 'active',
    });
    block.findFirst.mockResolvedValue({ id: 'block-1' });

    await expect(service.getThought('user-1', 'thought-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('paginates the fresh feed with exclusions applied', async () => {
    const { service, thought } = createService();
    thought.findMany.mockResolvedValue([
      thoughtRow(),
      thoughtRow({
        id: 'thought-2',
        createdAt: new Date('2026-09-14T10:00:00.000Z'),
      }),
    ]);

    const page = await service.listFresh('user-1', undefined, '1');

    expect(thought.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 }),
    );
    expect(page.thoughts).toHaveLength(1);
    expect(page.pageInfo).toEqual({
      hasMore: true,
      nextCursor: '2026-09-14T11:00:00.000Z_thought-1',
    });
  });

  it('treats duplicate likes as already liked', async () => {
    const { service, thoughtLike, thought } = createService();
    thought.findUnique.mockResolvedValue({
      id: 'thought-1',
      authorId: 'author-1',
      status: 'active',
    });
    thoughtLike.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.setLike({ ...activeUser }, 'thought-1', true),
    ).resolves.toEqual({ ok: true, liked: true });
  });

  it('reports a thought with a valid reason', async () => {
    const { service, thought, thoughtReport } = createService();
    thought.findUnique.mockResolvedValue({
      id: 'thought-1',
      authorId: 'author-1',
      status: 'active',
    });
    thoughtReport.create.mockResolvedValue({ id: 'report-1' });

    await expect(
      service.reportThought({ ...activeUser }, 'thought-1', {
        reason: 'spam',
      }),
    ).resolves.toEqual({ ok: true });
    expect(thoughtReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: 'spam' }),
      }),
    );
  });

  it('ranks the for-you pool before paging', async () => {
    const { service, thought, ranking } = createService();
    thought.findMany.mockResolvedValue([thoughtRow()]);

    const page = await service.listForYou('user-1', undefined, '20');

    expect(ranking.rank).toHaveBeenCalledTimes(1);
    expect(page.thoughts).toHaveLength(1);
    expect(page.pageInfo.hasMore).toBe(false);
  });

  it('sends impression batches to the worker when available', async () => {
    const { prisma, moderation, ranking, eventsQueue, thought, thoughtEvent } =
      createService();
    const service = new ThoughtsService(
      prisma,
      moderation,
      ranking,
      eventsQueue as never,
    );
    thought.findMany.mockResolvedValue([thoughtRow()]);

    await service.listFresh('user-1', undefined, '20');
    // Impressions are enqueued fire-and-forget; flush background microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(eventsQueue.add).toHaveBeenCalledWith(
      'THOUGHT_EVENT_PROCESS',
      expect.objectContaining({
        events: [
          expect.objectContaining({
            actorId: 'user-1',
            type: 'thought_impression',
            thoughtId: 'thought-1',
          }),
        ],
      }),
      expect.objectContaining({ attempts: 3 }),
    );
    expect(thoughtEvent.createMany).not.toHaveBeenCalled();
  });

  it('writes impressions inline when the queue is down', async () => {
    const { prisma, moderation, ranking, eventsQueue, thought, thoughtEvent } =
      createService();
    eventsQueue.add.mockRejectedValue(new Error('redis down'));
    thoughtEvent.createMany.mockResolvedValue({ count: 1 });
    const service = new ThoughtsService(
      prisma,
      moderation,
      ranking,
      eventsQueue as never,
    );
    thought.findMany.mockResolvedValue([thoughtRow()]);

    await service.listFresh('user-1', undefined, '20');
    // Flush fire-and-forget fallback path (queue reject -> createMany).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(thoughtEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            actorId: 'user-1',
            type: 'thought_impression',
          }),
        ],
      }),
    );
  });

  it('lets the author edit their thought', async () => {
    const { service, thought, moderation } = createService();
    thought.findUnique.mockResolvedValue({
      id: 'thought-1',
      authorId: 'user-1',
      status: 'active',
    });
    thought.update.mockResolvedValue(
      thoughtRow({ body: 'Edited body' }),
    );

    const result = await service.updateThought(
      { ...activeUser },
      'thought-1',
      '  Edited body  ',
    );

    expect(moderation.assertMessageAllowed).toHaveBeenCalledWith('Edited body');
    expect(thought.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'thought-1' },
        data: { body: 'Edited body' },
      }),
    );
    expect(result).toEqual(expect.objectContaining({ body: 'Edited body' }));
  });

  it('rejects edits from non-authors and blank bodies', async () => {
    const { service, thought } = createService();
    thought.findUnique.mockResolvedValue({
      id: 'thought-1',
      authorId: 'user-2',
      status: 'active',
    });

    await expect(
      service.updateThought({ ...activeUser }, 'thought-1', 'hello'),
    ).rejects.toThrow(ForbiddenException);

    thought.findUnique.mockResolvedValue({
      id: 'thought-1',
      authorId: 'user-1',
      status: 'active',
    });

    await expect(
      service.updateThought({ ...activeUser }, 'thought-1', '   '),
    ).rejects.toThrow(BadRequestException);
  });

  it('soft-deletes only the author’s own thought', async () => {
    const { service, thought } = createService();
    thought.findUnique.mockResolvedValue({
      id: 'thought-1',
      authorId: 'user-1',
      status: 'active',
    });
    thought.update.mockResolvedValue(thoughtRow());

    await expect(
      service.deleteThought({ ...activeUser }, 'thought-1'),
    ).resolves.toEqual({ ok: true });
    expect(thought.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'thought-1' },
        data: expect.objectContaining({ status: 'deleted' }),
      }),
    );

    thought.findUnique.mockResolvedValue({
      id: 'thought-1',
      authorId: 'user-2',
      status: 'active',
    });

    await expect(
      service.deleteThought({ ...activeUser }, 'thought-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('unshares by deleting the share row', async () => {
    const { service, thought, thoughtShare } = createService();
    thought.findUnique.mockResolvedValue({
      id: 'thought-1',
      authorId: 'user-2',
      status: 'active',
    });
    thoughtShare.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      service.unshareThought({ ...activeUser }, 'thought-1'),
    ).resolves.toEqual({ ok: true, shared: false });
    expect(thoughtShare.deleteMany).toHaveBeenCalledWith({
      where: { thoughtId: 'thought-1', userId: 'user-1' },
    });
  });

  it('returns an empty page when the viewer has no connections', async () => {
    const { service, thought, connection } = createService();
    connection.findMany.mockResolvedValue([]);

    const page = await service.listConnections('user-1', undefined, '20');

    expect(connection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'accepted' }) }),
    );
    expect(thought.findMany).not.toHaveBeenCalled();
    expect(page).toEqual({
      thoughts: [],
      pageInfo: { hasMore: false, nextCursor: null },
    });
  });

  it('hides avatars of authors who disabled avatar visibility', async () => {
    const { service, thought, prisma } = createService();
    jest.mocked(prisma.userSettings.findMany).mockResolvedValue([
      { userId: 'author-1', profileVisibility: { avatar: false } },
    ] as never);
    thought.findMany.mockResolvedValue([
      thoughtRow({
        author: authorRow({
          profile: {
            ...authorRow().profile,
            profilePictureType: 'toli',
            toliAvatarKey: 'vector_01',
            avatarUrl: 'https://example.com/a.png',
          },
        }),
      }),
    ]);

    const page = await service.listFresh('user-1', undefined, '20');

    expect(page.thoughts[0].author.profilePicture).toEqual({
      type: 'provider',
      avatarUrl: null,
      toliAvatarKey: null,
    });
  });

  describe('For You pagination', () => {
    type DbRow = {
      id: string;
      body: string;
      status: string;
      createdAt: Date;
      authorId: string;
      author: {
        id: string;
        publicUserId: string;
        profile: {
          username: string;
          displayName: string;
          avatarUrl: string | null;
          profilePictureType: string;
          toliAvatarKey: string | null;
          interests: string[];
          toliId: string | null;
          toli: null;
        };
      };
      _count: { likes: number; comments: number; shares: number };
    };

    const makeRows = (count: number, groups: number): DbRow[] => {
      const rows: DbRow[] = [];
      for (let i = 0; i < count; i += 1) {
        const group = i % groups;
        rows.push({
          id: `fy-${String(i).padStart(3, '0')}`,
          body: `thought ${i}`,
          status: 'active',
          createdAt: new Date(Date.UTC(2026, 8, 1) + group * 3_600_000),
          authorId: `author-${i % 30}`,
          author: {
            id: `author-${i % 30}`,
            publicUserId: 'HT-AAAAAAAA',
            profile: {
              username: `author_${i % 30}`,
              displayName: `Author ${i % 30}`,
              avatarUrl: null,
              profilePictureType: 'provider',
              toliAvatarKey: null,
              interests: [],
              toliId: null,
              toli: null,
            },
          },
          _count: {
            likes: (i * 7) % 50,
            comments: (i * 3) % 5,
            shares: (i * 11) % 7,
          },
        });
      }
      return rows;
    };

    // Faithful in-memory emulation of the Postgres keyset queries issued by
    // listForYou: composite (createdAt, id) bounds, id in/notIn, authorId
    // in/notIn, desc/desc ordering, take.
    const installDb = (ctx: ReturnType<typeof createService>, rows: DbRow[]) => {
      const { thought } = ctx;
      const matches = (row: DbRow, where: Record<string, unknown>): boolean => {
        if (where.status && row.status !== where.status) {
          return false;
        }
        const created = where.createdAt as { lt?: Date } | undefined;
        if (created?.lt && !(row.createdAt < created.lt)) {
          return false;
        }
        const orClauses = where.OR as
          | { createdAt?: { lt?: Date }; id?: { lt?: string } }[]
          | undefined;
        if (orClauses) {
          const hit = orClauses.some((clause) => {
            if (clause.createdAt?.lt) {
              return row.createdAt < clause.createdAt.lt;
            }
            return (
              row.createdAt.getTime() ===
                (clause.createdAt as Date).getTime() &&
              row.id < (clause.id?.lt ?? '')
            );
          });
          if (!hit) {
            return false;
          }
        }
        const idFilter = where.id as
          | { in?: string[]; notIn?: string[] }
          | undefined;
        if (idFilter?.in && !idFilter.in.includes(row.id)) {
          return false;
        }
        if (idFilter?.notIn && idFilter.notIn.includes(row.id)) {
          return false;
        }
        const authorFilter = where.authorId as
          | { in?: string[]; notIn?: string[] }
          | undefined;
        if (authorFilter?.in && !authorFilter.in.includes(row.authorId)) {
          return false;
        }
        if (authorFilter?.notIn && authorFilter.notIn.includes(row.authorId)) {
          return false;
        }
        return true;
      };

      thought.findMany.mockImplementation((args: {
        where: Record<string, unknown>;
        take?: number;
      }) => {
        const matched = rows
          .filter((row) => matches(row, args.where))
          .sort((a, b) =>
            b.createdAt.getTime() !== a.createdAt.getTime()
              ? b.createdAt.getTime() - a.createdAt.getTime()
              : b.id.localeCompare(a.id),
          );
        // Mirror Prisma: no take means no limit (the carried by-id fetch
        // passes none).
        return Promise.resolve(
          args.take === undefined ? matched : matched.slice(0, args.take),
        );
      });
      return rows;
    };

    const drainForYou = async (
      service: ThoughtsService,
      limit: string,
    ) => {
      let cursor: string | undefined;
      let deferred: string | undefined;
      const seen = new Map<string, unknown>();
      let pages = 0;
      while (true) {
        const res = await service.listForYou(
          'viewer-1',
          cursor,
          limit,
          deferred,
        );
        pages += 1;
        if (pages > 60) {
          throw new Error('pagination did not terminate');
        }
        for (const item of res.thoughts) {
          expect(seen.has(item.id)).toBe(false);
          seen.set(item.id, item);
        }
        if (!res.pageInfo.hasMore) {
          break;
        }
        cursor = res.pageInfo.nextCursor ?? undefined;
        deferred =
          res.deferred.length > 0 ? res.deferred.join(',') : undefined;
      }
      return { seen, pages };
    };

    it('drains 300 thoughts across pages with no skips or duplicates', async () => {
      const ctx = createService();
      const rows = installDb(ctx, makeRows(300, 10));

      const { seen, pages } = await drainForYou(ctx.service, '20');

      expect(seen.size).toBe(rows.length);
      for (const row of rows) {
        expect(seen.has(row.id)).toBe(true);
      }
      expect(pages).toBe(15);
    });

    it('serves identical-timestamp thoughts exactly once', async () => {
      const ctx = createService();
      // All 45 share one timestamp: ranking/dedup must rely on the id tiebreak.
      const rows = installDb(ctx, makeRows(45, 1));

      const { seen, pages } = await drainForYou(ctx.service, '20');

      expect(seen.size).toBe(rows.length);
      expect(pages).toBe(3);
    });

    it('drops newly hidden thoughts mid-pagination without dupes', async () => {
      const ctx = createService();
      const rows = installDb(ctx, makeRows(60, 6));
      const hidden = new Set(['fy-021', 'fy-033', 'fy-044', 'fy-055', 'fy-059']);
      const { thoughtHide } = ctx;
      let calls = 0;
      thoughtHide.findMany.mockImplementation(() => {
        calls += 1;
        // Hide five thoughts after the first page lands.
        return Promise.resolve(
          calls > 1
            ? [...hidden].map((thoughtId) => ({ thoughtId }))
            : [],
        );
      });

      let cursor: string | undefined;
      let deferred: string | undefined;
      const seen = new Map<string, number>();
      let pages = 0;
      while (true) {
        const res = await ctx.service.listForYou(
          'viewer-1',
          cursor,
          '20',
          deferred,
        );
        pages += 1;
        if (pages > 60) {
          throw new Error('pagination did not terminate');
        }
        for (const item of res.thoughts) {
          expect(seen.has(item.id)).toBe(false);
          seen.set(item.id, pages);
        }
        if (!res.pageInfo.hasMore) {
          break;
        }
        cursor = res.pageInfo.nextCursor ?? undefined;
        deferred =
          res.deferred.length > 0 ? res.deferred.join(',') : undefined;
      }

      // Hidden thoughts may only have been served before the hide took
      // effect (page 1); afterwards the carried set must drop them.
      for (const id of hidden) {
        if (seen.has(id)) {
          expect(seen.get(id)).toBe(1);
        }
      }
      expect(seen.size).toBeLessThanOrEqual(rows.length);
    });

    it('tolerates newly created thoughts between pages', async () => {
      const ctx = createService();
      const rows = installDb(ctx, makeRows(60, 6));

      let cursor: string | undefined;
      let deferred: string | undefined;
      const seen = new Map<string, unknown>();
      let pages = 0;
      while (true) {
        const res = await ctx.service.listForYou(
          'viewer-1',
          cursor,
          '20',
          deferred,
        );
        pages += 1;
        if (pages > 60) {
          throw new Error('pagination did not terminate');
        }
        for (const item of res.thoughts) {
          expect(seen.has(item.id)).toBe(false);
          seen.set(item.id, item);
        }
        if (pages === 1) {
          // A brand-new thought lands after page one: newer than every
          // cursor, so it must neither duplicate nor break the drain.
          rows.push({
            ...rows[0],
            id: 'fy-new',
            createdAt: new Date(Date.UTC(2026, 8, 2)),
          });
        }
        if (!res.pageInfo.hasMore) {
          break;
        }
        cursor = res.pageInfo.nextCursor ?? undefined;
        deferred =
          res.deferred.length > 0 ? res.deferred.join(',') : undefined;
      }

      for (const row of rows) {
        if (row.id !== 'fy-new') {
          expect(seen.has(row.id)).toBe(true);
        }
      }
    });

    it('rejects malformed cursors', async () => {
      const { service } = createService();
      await expect(
        service.listForYou('viewer-1', 'not-a-date', '20'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('limits the connections feed to connected authors', async () => {
    const { service, thought, connection } = createService();
    connection.findMany.mockResolvedValue([
      { requesterId: 'user-1', receiverId: 'user-2' },
      { requesterId: 'user-3', receiverId: 'user-1' },
    ]);
    thought.findMany.mockResolvedValue([thoughtRow()]);

    const page = await service.listConnections('user-1', undefined, '20');

    expect(thought.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          authorId: expect.objectContaining({ in: ['user-2', 'user-3'] }),
        }),
      }),
    );
    expect(page.thoughts).toHaveLength(1);
  });
});
