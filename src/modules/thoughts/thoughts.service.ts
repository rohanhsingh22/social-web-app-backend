import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { MessageStatus, Prisma, UserStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import {
  THOUGHT_EVENTS_QUEUE,
  THOUGHT_EVENT_PROCESS_JOB,
} from '@app/common/queues';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { ModerationService } from '@app/modules/moderation/moderation.service';
import { AuthenticatedUser } from '@app/modules/auth/auth.types';
import { perfNow, perfElapsedMs, formatPerfMs } from '@app/common/perf';
import { normalizePublicUserId } from '@app/common/public-user-id';
import { ThoughtsRankingService } from './thoughts-ranking.service';
import { ReportThoughtDto } from './dto/report-thought.dto';

const THOUGHT_BODY_MAX_LENGTH = 1000;
const COMMENT_BODY_MAX_LENGTH = 500;
const DEFAULT_FEED_LIMIT = 20;
const MAX_FEED_LIMIT = 50;
const FOR_YOU_POOL_SIZE = 200;
const IMPRESSION_EVENT_CAP = 20;

// Ranking/future-analytics events. connection_request is recorded by the
// connections flow (Phase 6); profile_open is recorded on public-profile
// reads. Everything else is recorded here.
export const THOUGHT_EVENT_TYPES = [
  'thought_impression',
  'thought_open',
  'thought_like',
  'thought_comment',
  'thought_share',
  'thought_hide',
  'thought_report',
  'profile_open',
  'connection_request',
] as const;

export type ThoughtEventType = (typeof THOUGHT_EVENT_TYPES)[number];

export type ThoughtEventBatchItem = {
  actorId: string;
  type: string;
  thoughtId: string | null;
};

const thoughtAuthorSelect = {
  id: true,
  publicUserId: true,
  profile: {
    select: {
      username: true,
      displayName: true,
      avatarUrl: true,
      profilePictureType: true,
      toliAvatarKey: true,
      interests: true,
      toliId: true,
      toli: { select: { id: true, name: true } },
    },
  },
};

const thoughtCountsSelect = {
  likes: true,
  comments: { where: { status: MessageStatus.active } },
  shares: true,
};

type ThoughtAuthorRow = {
  id: string;
  publicUserId: string;
  profile: {
    username: string;
    displayName: string;
    avatarUrl: string | null;
    profilePictureType: 'provider' | 'toli';
    toliAvatarKey: string | null;
    interests: string[];
    toliId: string | null;
    toli: { id: string; name: string } | null;
  } | null;
};

type ThoughtCardRow = {
  id: string;
  body: string;
  status: MessageStatus;
  createdAt: Date;
  author: ThoughtAuthorRow;
  _count: { likes: number; comments: number; shares: number };
};

@Injectable()
export class ThoughtsService {
  private readonly logger = new Logger(ThoughtsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly ranking: ThoughtsRankingService,
    @Optional()
    @InjectQueue(THOUGHT_EVENTS_QUEUE)
    private readonly eventsQueue?: Queue<{ events: ThoughtEventBatchItem[] }>,
  ) {}

  async createThought(user: AuthenticatedUser, body: string) {
    this.assertWriter(user);
    const text = this.normalizeBody(
      body,
      THOUGHT_BODY_MAX_LENGTH,
      'THOUGHT_BODY_REQUIRED',
      'THOUGHT_BODY_TOO_LONG',
    );
    await this.moderation.assertMessageAllowed(text);

    const thought = await this.prisma.thought.create({
      data: { authorId: user.id, body: text },
      include: {
        author: { select: thoughtAuthorSelect },
        _count: { select: thoughtCountsSelect },
      },
    });

    return this.toThoughtDto(thought, {
      liked: false,
      shared: false,
      hidden: false,
    });
  }

  async getThought(viewerId: string, id: string) {
    const thought = await this.activeThoughtOrThrow(id);
    await this.assertNotBlocked(viewerId, thought.authorId);

    const full = await this.prisma.thought.findUnique({
      where: { id },
      include: {
        author: { select: thoughtAuthorSelect },
        _count: { select: thoughtCountsSelect },
      },
    });

    if (!full) {
      throw new NotFoundException('THOUGHT_NOT_FOUND');
    }

    const flags = await this.viewerFlags(viewerId, [id]);
    void this.recordEvent(viewerId, 'thought_open', id);

    return this.toThoughtDto(full, flags.get(id) ?? this.emptyFlags());
  }

  async listFresh(viewerId: string, cursor?: string, limitValue?: string) {
    const totalStart = perfNow();
    const limit = this.parseLimit(limitValue);
    const cursorDate = cursor ? this.parseCursor(cursor) : undefined;
    const exclusionsStart = perfNow();
    const exclusions = await this.feedExclusions(viewerId);
    const exclusionsMs = perfElapsedMs(exclusionsStart);

    const poolStart = perfNow();
    const thoughts = await this.prisma.thought.findMany({
      where: {
        status: MessageStatus.active,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        ...exclusions,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        author: { select: thoughtAuthorSelect },
        _count: { select: thoughtCountsSelect },
      },
    });
    const poolMs = perfElapsedMs(poolStart);

    const result = await this.toFeedPage(
      viewerId,
      thoughts,
      limit,
      thoughts.length > limit,
      thoughts.length > limit ? this.oldestCursor(thoughts.slice(0, limit)) : null,
    );
    this.logger.debug(
      `listFresh viewer=${viewerId} total=${formatPerfMs(perfElapsedMs(totalStart))} exclusions=${formatPerfMs(exclusionsMs)} pool=${formatPerfMs(poolMs)}`,
    );
    return result;
  }

  async listForYou(viewerId: string, cursor?: string, limitValue?: string) {
    const totalStart = perfNow();
    const limit = this.parseLimit(limitValue);
    const cursorDate = cursor ? this.parseCursor(cursor) : undefined;
    // exclusions (blocks/hides/reports) and viewer profile are independent:
    // run concurrently to save one sequential DB round trip.
    const preStart = perfNow();
    const [exclusions, viewer] = await Promise.all([
      this.feedExclusions(viewerId),
      this.prisma.profile.findUnique({
        where: { userId: viewerId },
        select: { interests: true, toliId: true },
      }),
    ]);
    const preMs = perfElapsedMs(preStart);

    const poolStart = perfNow();
    const pool = await this.prisma.thought.findMany({
      where: {
        status: MessageStatus.active,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        ...exclusions,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: FOR_YOU_POOL_SIZE,
      include: {
        author: { select: thoughtAuthorSelect },
        _count: { select: thoughtCountsSelect },
      },
    });
    const poolMs = perfElapsedMs(poolStart);

    const rankStart = perfNow();
    const ranked = this.ranking.rank(
      pool.map((thought) => ({
        ...thought,
        authorInterests: thought.author.profile?.interests ?? [],
        authorToliId: thought.author.profile?.toliId ?? null,
        likeCount: thought._count.likes,
        commentCount: thought._count.comments,
        shareCount: thought._count.shares,
      })),
      {
        interests: viewer?.interests ?? [],
        toliId: viewer?.toliId ?? null,
      },
    );
    const rankMs = perfElapsedMs(rankStart);

    const picked = this.ranking.applyAuthorDiversity(ranked, limit);
    const page = picked.map((item) => item.thought);
    const hasMore = pool.length >= FOR_YOU_POOL_SIZE;

    const result = await this.toFeedPage(
      viewerId,
      page,
      limit,
      hasMore,
      hasMore ? this.oldestCursor(pool) : null,
    );
    this.logger.debug(
      `listForYou viewer=${viewerId} total=${formatPerfMs(perfElapsedMs(totalStart))} pre(excl+viewer)=${formatPerfMs(preMs)} pool=${formatPerfMs(poolMs)} rank=${formatPerfMs(rankMs)} poolSize=${pool.length}`,
    );
    return result;
  }

  async listMine(viewerId: string, cursor?: string, limitValue?: string) {
    const limit = this.parseLimit(limitValue);
    const cursorDate = cursor ? this.parseCursor(cursor) : undefined;

    const thoughts = await this.prisma.thought.findMany({
      where: {
        status: MessageStatus.active,
        authorId: viewerId,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        author: { select: thoughtAuthorSelect },
        _count: { select: thoughtCountsSelect },
      },
    });

    return this.toFeedPage(
      viewerId,
      thoughts,
      limit,
      thoughts.length > limit,
      thoughts.length > limit
        ? this.oldestCursor(thoughts.slice(0, limit))
        : null,
    );
  }

  async listByAuthor(
    viewerId: string,
    publicUserIdParam: string,
    cursor?: string,
    limitValue?: string,
  ) {
    const publicUserId = normalizePublicUserId(publicUserIdParam ?? '');

    if (!publicUserId) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    const target = await this.prisma.user.findUnique({
      where: { publicUserId },
      select: { id: true, status: true, publicUserId: true },
    });

    if (!target || target.status !== UserStatus.active) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    await this.assertNotBlocked(viewerId, target.id);

    const limit = this.parseLimit(limitValue);
    const cursorDate = cursor ? this.parseCursor(cursor) : undefined;

    // Your own tab shows everything you posted (even items you hid).
    // Other users' lists respect your hides/reports.
    let excludedIds: string[] = [];
    if (viewerId !== target.id) {
      const [hiddenIds, reportedIds] = await Promise.all([
        this.prisma.thoughtHide
          .findMany({
            where: { userId: viewerId },
            select: { thoughtId: true },
          })
          .then((rows) => rows.map((row) => row.thoughtId)),
        this.prisma.thoughtReport
          .findMany({
            where: { reporterId: viewerId },
            select: { thoughtId: true },
          })
          .then((rows) => rows.map((row) => row.thoughtId)),
      ]);
      excludedIds = [...hiddenIds, ...reportedIds];
    }

    const thoughts = await this.prisma.thought.findMany({
      where: {
        status: MessageStatus.active,
        authorId: target.id,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        ...(excludedIds.length > 0 ? { id: { notIn: excludedIds } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        author: { select: thoughtAuthorSelect },
        _count: { select: thoughtCountsSelect },
      },
    });

    const page = await this.toFeedPage(
      viewerId,
      thoughts,
      limit,
      thoughts.length > limit,
      thoughts.length > limit
        ? this.oldestCursor(thoughts.slice(0, limit))
        : null,
    );

    return {
      ...page,
      author: { userId: target.id, publicUserId: target.publicUserId },
    };
  }

  async setLike(user: AuthenticatedUser, id: string, liked: boolean) {
    this.assertWriter(user);
    const thought = await this.activeThoughtOrThrow(id);
    await this.assertNotBlocked(user.id, thought.authorId);

    if (liked) {
      try {
        await this.prisma.thoughtLike.create({
          data: { thoughtId: id, userId: user.id },
        });
      } catch (error) {
        if (!this.isUniqueConflict(error)) {
          throw error;
        }
      }

      void this.recordEvent(user.id, 'thought_like', id);
    } else {
      await this.prisma.thoughtLike.deleteMany({
        where: { thoughtId: id, userId: user.id },
      });
    }

    return { ok: true, liked };
  }

  async shareThought(user: AuthenticatedUser, id: string) {
    this.assertWriter(user);
    const thought = await this.activeThoughtOrThrow(id);
    await this.assertNotBlocked(user.id, thought.authorId);

    try {
      await this.prisma.thoughtShare.create({
        data: { thoughtId: id, userId: user.id },
      });
    } catch (error) {
      if (!this.isUniqueConflict(error)) {
        throw error;
      }
    }

    void this.recordEvent(user.id, 'thought_share', id);

    return { ok: true };
  }

  async unshareThought(user: AuthenticatedUser, id: string) {
    this.assertWriter(user);
    await this.activeThoughtOrThrow(id);

    await this.prisma.thoughtShare.deleteMany({
      where: { thoughtId: id, userId: user.id },
    });

    return { ok: true, shared: false };
  }

  async updateThought(user: AuthenticatedUser, id: string, body: string) {
    this.assertWriter(user);
    const thought = await this.activeThoughtOrThrow(id);
    this.assertOwner(user.id, thought.authorId);

    const text = this.normalizeBody(
      body,
      THOUGHT_BODY_MAX_LENGTH,
      'THOUGHT_BODY_REQUIRED',
      'THOUGHT_BODY_TOO_LONG',
    );
    await this.moderation.assertMessageAllowed(text);

    const updated = await this.prisma.thought.update({
      where: { id },
      data: { body: text },
      include: {
        author: { select: thoughtAuthorSelect },
        _count: { select: thoughtCountsSelect },
      },
    });

    const flags = await this.viewerFlags(user.id, [id]);

    return this.toThoughtDto(updated, flags.get(id) ?? this.emptyFlags());
  }

  async deleteThought(user: AuthenticatedUser, id: string) {
    this.assertWriter(user);
    const thought = await this.activeThoughtOrThrow(id);
    this.assertOwner(user.id, thought.authorId);

    await this.prisma.thought.update({
      where: { id },
      data: { status: MessageStatus.deleted, deletedAt: new Date() },
    });

    return { ok: true };
  }

  async setHidden(user: AuthenticatedUser, id: string, hidden: boolean) {
    this.assertWriter(user);
    await this.activeThoughtOrThrow(id);

    if (hidden) {
      try {
        await this.prisma.thoughtHide.create({
          data: { thoughtId: id, userId: user.id },
        });
      } catch (error) {
        if (!this.isUniqueConflict(error)) {
          throw error;
        }
      }

      void this.recordEvent(user.id, 'thought_hide', id);
    } else {
      await this.prisma.thoughtHide.deleteMany({
        where: { thoughtId: id, userId: user.id },
      });
    }

    return { ok: true, hidden };
  }

  async reportThought(
    user: AuthenticatedUser,
    id: string,
    dto: ReportThoughtDto,
  ) {
    this.assertWriter(user);
    const thought = await this.activeThoughtOrThrow(id);
    await this.assertNotBlocked(user.id, thought.authorId);

    await this.prisma.thoughtReport.create({
      data: {
        thoughtId: id,
        reporterId: user.id,
        reason: dto.reason,
        details: dto.details,
      },
    });

    void this.recordEvent(user.id, 'thought_report', id);

    return { ok: true };
  }

  async createComment(user: AuthenticatedUser, id: string, body: string) {
    this.assertWriter(user);
    const text = this.normalizeBody(
      body,
      COMMENT_BODY_MAX_LENGTH,
      'COMMENT_BODY_REQUIRED',
      'COMMENT_BODY_TOO_LONG',
    );
    const thought = await this.activeThoughtOrThrow(id);
    await this.assertNotBlocked(user.id, thought.authorId);
    await this.moderation.assertMessageAllowed(text);

    const comment = await this.prisma.thoughtComment.create({
      data: { thoughtId: id, authorId: user.id, body: text },
      include: { author: { select: thoughtAuthorSelect } },
    });

    void this.recordEvent(user.id, 'thought_comment', id);

    return this.toCommentDto(comment);
  }

  async listComments(
    viewerId: string,
    id: string,
    cursor?: string,
    limitValue?: string,
  ) {
    const limit = this.parseLimit(limitValue);
    const cursorDate = cursor ? this.parseCursor(cursor) : undefined;
    const thought = await this.activeThoughtOrThrow(id);
    await this.assertNotBlocked(viewerId, thought.authorId);

    const comments = await this.prisma.thoughtComment.findMany({
      where: {
        thoughtId: id,
        status: MessageStatus.active,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { author: { select: thoughtAuthorSelect } },
    });

    const hasMore = comments.length > limit;
    const page = hasMore ? comments.slice(0, limit) : comments;
    const items = page.reverse().map((comment) => this.toCommentDto(comment));

    return {
      thoughtId: id,
      comments: items,
      pageInfo: {
        hasMore,
        nextCursor: hasMore
          ? page[page.length - 1]?.createdAt.toISOString() ?? null
          : null,
      },
    };
  }

  async recordEvent(
    actorId: string,
    type: ThoughtEventType,
    thoughtId?: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    try {
      await this.prisma.thoughtEvent.create({
        data: {
          actorId,
          type,
          thoughtId: thoughtId ?? null,
          metadata: metadata ?? undefined,
        },
      });
    } catch (error) {
      // Analytics must never break the request path.
      this.logger.debug(
        `Thought event ${type} dropped: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async toFeedPage(
    viewerId: string,
    thoughts: ThoughtCardRow[],
    limit: number,
    hasMore: boolean,
    nextCursor: string | null,
  ) {
    const page = thoughts.slice(0, limit);
    const flagsStart = perfNow();
    const flags = await this.viewerFlags(
      viewerId,
      page.map((thought) => thought.id),
    );
    const flagsMs = perfElapsedMs(flagsStart);

    const items = page.map((thought) =>
      this.toThoughtDto(thought, flags.get(thought.id) ?? this.emptyFlags()),
    );

    // Impressions must never block or fail the feed response. Enqueue in the
    // background: HTTP request → feed generation → response, with queueing
    // continuing concurrently. Errors are logged inside recordImpressions.
    void this.recordImpressions(
      viewerId,
      items.map((item) => item.id),
    ).catch((error) => {
      this.logger.debug(
        `recordImpressions background failure: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    });
    this.logger.debug(
      `toFeedPage viewer=${viewerId} flags=${formatPerfMs(flagsMs)} pageSize=${page.length}`,
    );

    return {
      thoughts: items,
      pageInfo: { hasMore, nextCursor: hasMore ? nextCursor : null },
    };
  }

  private oldestCursor(thoughts: { createdAt: Date }[]): string | null {
    if (thoughts.length === 0) {
      return null;
    }

    const oldest = thoughts.reduce((min, thought) =>
      thought.createdAt < min.createdAt ? thought : min,
    );

    return oldest.createdAt.toISOString();
  }

  private async recordImpressions(
    viewerId: string,
    thoughtIds: string[],
  ): Promise<void> {
    const queueStart = perfNow();
    const events = thoughtIds.slice(0, IMPRESSION_EVENT_CAP).map((thoughtId) => ({
      actorId: viewerId,
      type: 'thought_impression',
      thoughtId,
    }));

    if (events.length === 0) {
      return;
    }

    // Impression volume scales with feed traffic, so it goes through the
    // worker. Single action events stay synchronous (cheap, ordered).
    // This method is always invoked fire-and-forget from toFeedPage so the
    // Redis round trip never delays the HTTP response.
    if (this.eventsQueue) {
      try {
        await this.eventsQueue.add(
          THOUGHT_EVENT_PROCESS_JOB,
          { events },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 100,
            removeOnFail: 1000,
          },
        );
        this.logger.debug(
          `recordImpressions viewer=${viewerId} count=${events.length} queue=${formatPerfMs(perfElapsedMs(queueStart))}`,
        );
        return;
      } catch (error) {
        this.logger.debug(
          `Event queue unavailable, writing impressions directly: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    try {
      await this.prisma.thoughtEvent.createMany({ data: events });
      this.logger.debug(
        `recordImpressions viewer=${viewerId} count=${events.length} inline=${formatPerfMs(perfElapsedMs(queueStart))}`,
      );
    } catch (error) {
      this.logger.debug(
        `Thought impressions dropped: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async feedExclusions(viewerId: string) {
    const start = perfNow();
    const [blockedIds, hiddenIds, reportedIds] = await Promise.all([
      this.blockedUserIds(viewerId),
      this.prisma.thoughtHide
        .findMany({ where: { userId: viewerId }, select: { thoughtId: true } })
        .then((rows) => rows.map((row) => row.thoughtId)),
      this.prisma.thoughtReport
        .findMany({
          where: { reporterId: viewerId },
          select: { thoughtId: true },
        })
        .then((rows) => rows.map((row) => row.thoughtId)),
    ]);
    this.logger.debug(
      `feedExclusions viewer=${viewerId} total=${formatPerfMs(perfElapsedMs(start))} blocked=${blockedIds.length} hidden=${hiddenIds.length} reported=${reportedIds.length}`,
    );

    return {
      authorId: { notIn: blockedIds },
      id: { notIn: [...hiddenIds, ...reportedIds] },
      author: { is: { status: UserStatus.active } },
    };
  }

  private async blockedUserIds(viewerId: string): Promise<string[]> {
    const rows = await this.prisma.block.findMany({
      where: {
        OR: [{ blockerId: viewerId }, { blockedUserId: viewerId }],
      },
      select: { blockerId: true, blockedUserId: true },
    });

    return rows.map((row) =>
      row.blockerId === viewerId ? row.blockedUserId : row.blockerId,
    );
  }

  private async viewerFlags(viewerId: string, thoughtIds: string[]) {
    if (thoughtIds.length === 0) {
      return new Map<string, { liked: boolean; shared: boolean; hidden: boolean }>();
    }

    const start = perfNow();
    const [likes, shares, hides] = await Promise.all([
      this.prisma.thoughtLike.findMany({
        where: { userId: viewerId, thoughtId: { in: thoughtIds } },
        select: { thoughtId: true },
      }),
      this.prisma.thoughtShare.findMany({
        where: { userId: viewerId, thoughtId: { in: thoughtIds } },
        select: { thoughtId: true },
      }),
      this.prisma.thoughtHide.findMany({
        where: { userId: viewerId, thoughtId: { in: thoughtIds } },
        select: { thoughtId: true },
      }),
    ]);
    this.logger.debug(
      `viewerFlags viewer=${viewerId} total=${formatPerfMs(perfElapsedMs(start))} ids=${thoughtIds.length}`,
    );

    const liked = new Set(likes.map((row) => row.thoughtId));
    const shared = new Set(shares.map((row) => row.thoughtId));
    const hidden = new Set(hides.map((row) => row.thoughtId));

    return new Map(
      thoughtIds.map((id) => [
        id,
        {
          liked: liked.has(id),
          shared: shared.has(id),
          hidden: hidden.has(id),
        },
      ]),
    );
  }

  private emptyFlags() {
    return { liked: false, shared: false, hidden: false };
  }

  private async activeThoughtOrThrow(id: string) {
    const thought = await this.prisma.thought.findUnique({
      where: { id },
      select: { id: true, authorId: true, status: true },
    });

    if (!thought || thought.status !== MessageStatus.active) {
      throw new NotFoundException('THOUGHT_NOT_FOUND');
    }

    return thought;
  }

  private async assertNotBlocked(viewerId: string, authorId: string) {
    if (viewerId === authorId) {
      return;
    }

    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedUserId: authorId },
          { blockerId: authorId, blockedUserId: viewerId },
        ],
      },
      select: { id: true },
    });

    if (blocked) {
      throw new NotFoundException('THOUGHT_NOT_FOUND');
    }
  }

  private assertWriter(user: AuthenticatedUser) {
    if (user.status !== UserStatus.active) {
      throw new ForbiddenException('ACCOUNT_NOT_ALLOWED');
    }
  }

  private assertOwner(userId: string, authorId: string) {
    if (userId !== authorId) {
      throw new ForbiddenException('THOUGHT_ACTION_NOT_ALLOWED');
    }
  }

  private normalizeBody(
    body: string,
    max: number,
    requiredCode: string,
    tooLongCode: string,
  ): string {
    const text = body.trim();

    if (!text) {
      throw new BadRequestException(requiredCode);
    }

    if (text.length > max) {
      throw new BadRequestException(tooLongCode);
    }

    return text;
  }

  private toAuthorCard(author: ThoughtAuthorRow) {
    const profile = author.profile;
    const isToli = profile?.profilePictureType === 'toli';

    return {
      userId: author.id,
      publicUserId: author.publicUserId,
      username: profile?.username ?? 'unknown',
      displayName: profile?.displayName ?? 'Unknown',
      profilePicture: {
        type: profile?.profilePictureType ?? 'provider',
        avatarUrl: !isToli ? (profile?.avatarUrl ?? null) : null,
        toliAvatarKey: isToli ? (profile?.toliAvatarKey ?? null) : null,
      },
      toli: profile?.toli ?? null,
    };
  }

  private toThoughtDto(
    thought: ThoughtCardRow,
    viewer: { liked: boolean; shared: boolean; hidden: boolean },
  ) {
    return {
      id: thought.id,
      body: thought.body,
      status: thought.status,
      createdAt: thought.createdAt,
      author: this.toAuthorCard(thought.author),
      counts: {
        likes: thought._count.likes,
        comments: thought._count.comments,
        shares: thought._count.shares,
      },
      viewer,
    };
  }

  private toCommentDto(comment: {
    id: string;
    body: string;
    status: MessageStatus;
    createdAt: Date;
    author: ThoughtAuthorRow;
  }) {
    return {
      id: comment.id,
      body: comment.body,
      status: comment.status,
      createdAt: comment.createdAt,
      author: this.toAuthorCard(comment.author),
    };
  }

  private parseLimit(value?: string) {
    const limit = Number(value ?? DEFAULT_FEED_LIMIT);

    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException('INVALID_LIMIT');
    }

    return Math.min(limit, MAX_FEED_LIMIT);
  }

  private parseCursor(cursor: string) {
    const date = new Date(cursor);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('INVALID_CURSOR');
    }

    return date;
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
