import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ConnectionStatus,
  HomeJoinRequestStatus,
  HomeMemberRole,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { RateLimitService } from '@app/common/rate-limit.service';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { FanoutService } from '@app/realtime/fanout/fanout.service';
import { PresenceService } from '@app/realtime/presence/presence.service';
import {
  HOME_JOIN_REQUEST_RATE_LIMIT,
  HOME_JOIN_REQUEST_RATE_WINDOW_SECONDS,
  HOME_ACTION_RATE_LIMIT,
  HOME_ACTION_RATE_WINDOW_SECONDS,
  MAX_HOME_MEMBERS,
  MAX_PENDING_JOIN_REQUESTS_PER_HOME,
} from './home.constants';
import { buildJoinRequestExpiry, isExpired } from './home.policy';
import { HomePolicyService } from './home-policy.service';
import { HomeMembershipService } from './home-membership.service';
import { HomeService } from './home.service';

/**
 * Home join requests (Phase 4).
 * A homeless user requests to join through a target member they are
 * connected to — never directly via the owner (spec #43). The request
 * carries the target's Home at creation; capacity is enforced at both
 * creation (#42) and acceptance (#15).
 */
@Injectable()
export class HomeJoinRequestService {
  private readonly logger = new Logger(HomeJoinRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly homes: HomeService,
    private readonly memberships: HomeMembershipService,
    private readonly policy: HomePolicyService,
    private readonly presence: PresenceService,
    private readonly rateLimit: RateLimitService,
    private readonly fanout: FanoutService,
  ) {}

  async createJoinRequest(requesterId: string, targetMemberId: string) {
    if (requesterId === targetMemberId) {
      throw new BadRequestException('CANNOT_REQUEST_SELF');
    }

    await this.rateLimit.assertAllowed(
      `home:request:rate:${requesterId}`,
      HOME_JOIN_REQUEST_RATE_LIMIT,
      HOME_JOIN_REQUEST_RATE_WINDOW_SECONDS,
    );

    const [requester, target] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: requesterId },
        select: { id: true, status: true },
      }),
      this.prisma.user.findUnique({
        where: { id: targetMemberId },
        select: { id: true, status: true },
      }),
    ]);

    if (!requester || requester.status !== UserStatus.active) {
      throw new ForbiddenException('ACCOUNT_NOT_ALLOWED');
    }
    if (!target || target.status === UserStatus.deleted) {
      throw new NotFoundException('USER_NOT_FOUND');
    }
    if (target.status === UserStatus.banned) {
      throw new ForbiddenException('USER_UNAVAILABLE');
    }

    const [requesterMembership, targetMembership] = await Promise.all([
      this.prisma.homeMembership.findUnique({ where: { userId: requesterId } }),
      this.prisma.homeMembership.findUnique({
        where: { userId: targetMemberId },
      }),
    ]);
    this.policy.assertCanRequestJoin({
      requesterHomeId: requesterMembership?.homeId ?? null,
      targetHomeId: targetMembership?.homeId ?? null,
    });
    if (!targetMembership) {
      throw new ConflictException('TARGET_HAS_NO_HOME');
    }

    const { userLowId, userHighId } = this.normalizedPair(
      requesterId,
      targetMemberId,
    );
    const connection = await this.prisma.connection.findUnique({
      where: { userLowId_userHighId: { userLowId, userHighId } },
    });
    if (!connection || connection.status !== ConnectionStatus.accepted) {
      throw new ForbiddenException('NOT_A_CONNECTION');
    }

    if (!(await this.presence.isUserOnline(targetMemberId))) {
      throw new ConflictException('TARGET_OFFLINE');
    }

    const home = await this.prisma.home.findUnique({
      where: { id: targetMembership.homeId },
    });
    if (!home) {
      throw new NotFoundException('HOME_NOT_FOUND');
    }

    const [memberCount, pendingInHome, duplicate] = await Promise.all([
      this.prisma.homeMembership.count({ where: { homeId: home.id } }),
      this.prisma.homeJoinRequest.count({
        where: { homeId: home.id, status: HomeJoinRequestStatus.PENDING },
      }),
      this.prisma.homeJoinRequest.findFirst({
        where: {
          homeId: home.id,
          requesterId,
          status: HomeJoinRequestStatus.PENDING,
        },
      }),
    ]);
    if (duplicate) {
      throw new ConflictException('JOIN_REQUEST_ALREADY_PENDING');
    }
    if (memberCount >= MAX_HOME_MEMBERS) {
      throw new ConflictException('HOME_FULL');
    }
    if (pendingInHome >= MAX_PENDING_JOIN_REQUESTS_PER_HOME) {
      throw new ConflictException('JOIN_REQUEST_LIMIT_REACHED');
    }

    const request = await this.prisma.homeJoinRequest.create({
      data: {
        homeId: home.id,
        requesterId,
        targetMemberId,
        status: HomeJoinRequestStatus.PENDING,
        expiresAt: buildJoinRequestExpiry(),
      },
    });

    this.logger.log(
      `home.join_request.created home=${home.id} requester=${requesterId} target=${targetMemberId}`,
    );
    void this.fanout.publishUserEvent(
      [requesterId, targetMemberId],
      'home:join-request:new',
      {
        joinRequest: {
          id: request.id,
          homeId: request.homeId,
          requesterId,
          targetMemberId,
          expiresAt: request.expiresAt.toISOString(),
        },
      },
    );
    return request;
  }

  async acceptJoinRequest(userId: string, requestId: string) {
    await this.rateLimit.assertAllowed(
      `home:actions:rate:${userId}`,
      HOME_ACTION_RATE_LIMIT,
      HOME_ACTION_RATE_WINDOW_SECONDS,
    );
    const request = await this.prisma.homeJoinRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('JOIN_REQUEST_NOT_FOUND');
    }
    if (request.targetMemberId !== userId) {
      throw new ForbiddenException('JOIN_REQUEST_ACTION_NOT_ALLOWED');
    }
    if (request.status !== HomeJoinRequestStatus.PENDING) {
      throw new ConflictException('JOIN_REQUEST_ALREADY_RESPONDED');
    }
    if (isExpired(request.expiresAt)) {
      await this.markExpired(request.id);
      throw new ConflictException('JOIN_REQUEST_EXPIRED');
    }

    const targetMembership = await this.prisma.homeMembership.findUnique({
      where: { userId: request.targetMemberId },
    });
    if (!targetMembership || targetMembership.homeId !== request.homeId) {
      await this.markExpired(request.id);
      throw new ConflictException('JOIN_REQUEST_EXPIRED');
    }

    let homeId: string;
    try {
      homeId = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.homeJoinRequest.findUnique({
          where: { id: requestId },
        });
        if (!fresh) {
          throw new NotFoundException('JOIN_REQUEST_NOT_FOUND');
        }
        if (fresh.status !== HomeJoinRequestStatus.PENDING) {
          throw new ConflictException('JOIN_REQUEST_ALREADY_RESPONDED');
        }
        if (isExpired(fresh.expiresAt)) {
          throw new ConflictException('JOIN_REQUEST_EXPIRED');
        }
        const home = await tx.home.findUnique({
          where: { id: fresh.homeId },
        });
        if (!home) {
          throw new NotFoundException('HOME_DESTROYED');
        }
        const targetStillThere = await tx.homeMembership.findUnique({
          where: { userId: fresh.targetMemberId },
        });
        if (!targetStillThere || targetStillThere.homeId !== fresh.homeId) {
          throw new ConflictException('JOIN_REQUEST_EXPIRED');
        }
        await this.memberships.joinHomeInTx(
          tx,
          fresh.homeId,
          fresh.requesterId,
          HomeMemberRole.PARTICIPANT,
        );
        await tx.homeJoinRequest.update({
          where: { id: requestId },
          data: {
            status: HomeJoinRequestStatus.ACCEPTED,
            respondedAt: new Date(),
          },
        });
        return fresh.homeId;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('ALREADY_IN_HOME');
      }
      throw error;
    }

    const home = await this.homes.getHomeById(homeId);
    this.logger.log(
      `home.join_request.accepted home=${homeId} requester=${request.requesterId}`,
    );
    void this.fanout.publishUserEvent(
      home.memberships.map((m) => m.userId),
      'home:changed',
    );
    return home;
  }

  async rejectJoinRequest(userId: string, requestId: string) {
    await this.rateLimit.assertAllowed(
      `home:actions:rate:${userId}`,
      HOME_ACTION_RATE_LIMIT,
      HOME_ACTION_RATE_WINDOW_SECONDS,
    );
    const request = await this.prisma.homeJoinRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('JOIN_REQUEST_NOT_FOUND');
    }
    if (request.targetMemberId !== userId) {
      throw new ForbiddenException('JOIN_REQUEST_ACTION_NOT_ALLOWED');
    }
    if (request.status !== HomeJoinRequestStatus.PENDING) {
      throw new ConflictException('JOIN_REQUEST_ALREADY_RESPONDED');
    }
    if (isExpired(request.expiresAt)) {
      await this.markExpired(request.id);
      throw new ConflictException('JOIN_REQUEST_EXPIRED');
    }

    const rejected = await this.prisma.homeJoinRequest.update({
      where: { id: requestId },
      data: {
        status: HomeJoinRequestStatus.REJECTED,
        respondedAt: new Date(),
      },
    });

    this.logger.log(
      `home.join_request.rejected home=${request.homeId} requester=${request.requesterId}`,
    );
    void this.fanout.publishUserEvent(
      [request.requesterId, userId],
      'home:changed',
    );
    return rejected;
  }

  /** Bulk sweep for a future worker schedule; also covered lazily. */
  async expireStaleJoinRequests(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.homeJoinRequest.updateMany({
      where: {
        status: HomeJoinRequestStatus.PENDING,
        expiresAt: { lte: now },
      },
      data: {
        status: HomeJoinRequestStatus.EXPIRED,
        respondedAt: now,
      },
    });
    if (result.count > 0) {
      this.logger.log(`home.join_request.expired count=${result.count}`);
    }
    return result.count;
  }

  private async markExpired(requestId: string): Promise<void> {
    await this.prisma.homeJoinRequest.update({
      where: { id: requestId },
      data: {
        status: HomeJoinRequestStatus.EXPIRED,
        respondedAt: new Date(),
      },
    });
  }

  private normalizedPair(firstUserId: string, secondUserId: string) {
    const [userLowId, userHighId] = [firstUserId, secondUserId].sort();
    return { userLowId, userHighId };
  }
}
