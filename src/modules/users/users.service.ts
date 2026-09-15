import { Injectable } from "@nestjs/common";
import { ConnectionStatus, UserStatus } from "@prisma/client";
import { RateLimitService } from "@app/common/rate-limit.service";
import { normalizePublicUserId } from "@app/common/public-user-id";
import { profileCardSelect } from "@app/common/profile-card";
import { PrismaService } from "@app/core/prisma/prisma.service";

const SEARCH_RATE_LIMIT = 60;
const SEARCH_WINDOW_SECONDS = 60;

const publicProfileSelect = {
  ...profileCardSelect,
  bio: true,
  ageGroup: true,
  region: true,
  primaryLanguage: true,
  languages: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async search(viewerId: string, query = "", _limitValue?: string) {
    await this.rateLimit.assertAllowed(
      `ratelimit:users:search:${viewerId}`,
      SEARCH_RATE_LIMIT,
      SEARCH_WINDOW_SECONDS,
    );

    const publicUserId = normalizePublicUserId(query);

    if (!publicUserId) {
      return [];
    }

    const user = await this.prisma.user.findFirst({
      where: {
        publicUserId,
        id: { not: viewerId },
        status: UserStatus.active,
        blocksMade: { none: { blockedUserId: viewerId } },
        blocksReceived: { none: { blockerId: viewerId } },
        profile: { isNot: null },
      },
      select: {
        id: true,
        publicUserId: true,
        profile: {
          select: publicProfileSelect,
        },
      },
    });

    if (!user?.profile) {
      return [];
    }

    const connection = await this.prisma.connection.findFirst({
      where: this.connectionWhere(viewerId, user.id),
      select: {
        id: true,
        requesterId: true,
        receiverId: true,
        status: true,
      },
    });

    return [
      {
        id: user.publicUserId,
        profile: user.profile,
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
      },
    ];
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
}
