import { BadRequestException, Injectable } from "@nestjs/common";
import { ConnectionStatus, UserStatus } from "@prisma/client";
import { RateLimitService } from "@app/common/rate-limit.service";
import { PrismaService } from "@app/core/prisma/prisma.service";

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const SEARCH_RATE_LIMIT = 60;
const SEARCH_WINDOW_SECONDS = 60;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async search(viewerId: string, query = "", limitValue?: string) {
    await this.rateLimit.assertAllowed(
      `ratelimit:users:search:${viewerId}`,
      SEARCH_RATE_LIMIT,
      SEARCH_WINDOW_SECONDS,
    );

    const q = query.trim();

    if (q.length < 2) {
      return [];
    }

    const limit = this.parseLimit(limitValue);

    const profiles = await this.prisma.profile.findMany({
      where: {
        userId: { not: viewerId },
        OR: [
          { username: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
        ],
        user: {
          status: UserStatus.active,
          blocksMade: { none: { blockedUserId: viewerId } },
          blocksReceived: { none: { blockerId: viewerId } },
        },
      },
      take: limit,
      orderBy: [{ displayName: "asc" }, { username: "asc" }],
      select: {
        userId: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        ageGroup: true,
        region: true,
        primaryLanguage: true,
        languages: true,
      },
    });

    const userIds = profiles.map((profile) => profile.userId);
    const connections = userIds.length
      ? await this.prisma.connection.findMany({
          where: {
            OR: userIds.map((userId) => this.connectionWhere(viewerId, userId)),
          },
          select: {
            id: true,
            requesterId: true,
            receiverId: true,
            status: true,
          },
        })
      : [];

    return profiles.map((profile) => {
      const connection = connections.find(
        (item) =>
          item.requesterId === profile.userId ||
          item.receiverId === profile.userId,
      );

      return {
        id: profile.userId,
        profile,
        connection: connection
          ? {
              id: connection.id,
              status: connection.status,
              direction:
                connection.status === ConnectionStatus.pending
                  ? this.pendingDirection(viewerId, connection)
                  : null,
            }
          : null,
      };
    });
  }

  private connectionWhere(viewerId: string, otherUserId: string) {
    const [userLowId, userHighId] = [viewerId, otherUserId].sort();
    return { userLowId, userHighId };
  }

  private pendingDirection(
    viewerId: string,
    connection: { requesterId: string; receiverId: string },
  ) {
    return connection.requesterId === viewerId ? "sent" : "received";
  }

  private parseLimit(value?: string) {
    const limit = Number(value ?? DEFAULT_SEARCH_LIMIT);

    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException("INVALID_LIMIT");
    }

    return Math.min(limit, MAX_SEARCH_LIMIT);
  }
}
