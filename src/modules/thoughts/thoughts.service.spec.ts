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
      applyAuthorDiversity: jest.fn((items: unknown[]) => items),
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
      nextCursor: '2026-09-14T11:00:00.000Z',
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
