import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HomeMemberRole, Prisma } from '@prisma/client';
import { RateLimitService } from '@app/common/rate-limit.service';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { FanoutService } from '@app/realtime/fanout/fanout.service';
import {
  HOME_ACTION_RATE_LIMIT,
  HOME_ACTION_RATE_WINDOW_SECONDS,
} from './home.constants';
import { HomePolicyService } from './home-policy.service';
import { HomeService } from './home.service';
import { HomeVoiceService } from './voice/home-voice.service';

/**
 * Home membership (Phase 2).
 * Owns: join, leave, remove, membership reads, capacity/one-home checks.
 * joinHomeInTx is exposed so Phase 3/4 accept flows can join inside their
 * own invitation/request transaction instead of nesting transactions.
 */
@Injectable()
export class HomeMembershipService {
  private readonly logger = new Logger(HomeMembershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly homes: HomeService,
    private readonly policy: HomePolicyService,
    private readonly fanout: FanoutService,
    private readonly voice: HomeVoiceService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private actionLimit(userId: string): Promise<void> {
    return this.rateLimit.assertAllowed(
      `home:actions:rate:${userId}`,
      HOME_ACTION_RATE_LIMIT,
      HOME_ACTION_RATE_WINDOW_SECONDS,
    );
  }

  async getMembership(userId: string) {
    return this.prisma.homeMembership.findUnique({ where: { userId } });
  }

  async getMembers(homeId: string) {
    return this.prisma.homeMembership.findMany({
      where: { homeId },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async countMembers(homeId: string): Promise<number> {
    return this.prisma.homeMembership.count({ where: { homeId } });
  }

  /**
   * Join core usable inside a larger transaction (Phase 3/4 accept).
   * Locks the Home row via touch-update so concurrent accepts serialize
   * and the 4-member cap can never be exceeded.
   */
  async joinHomeInTx(
    tx: Prisma.TransactionClient,
    homeId: string,
    userId: string,
    role: HomeMemberRole = HomeMemberRole.PARTICIPANT,
  ) {
    const home = await tx.home.findUnique({ where: { id: homeId } });
    if (!home) {
      throw new NotFoundException('HOME_NOT_FOUND');
    }

    await tx.home.update({
      where: { id: homeId },
      data: { updatedAt: new Date() },
    });

    const existing = await tx.homeMembership.findUnique({
      where: { userId },
    });
    const memberCount = await tx.homeMembership.count({
      where: { homeId },
    });
    this.policy.assertCanJoin(existing?.homeId ?? null, memberCount);

    return tx.homeMembership.create({
      data: { homeId, userId, role },
    });
  }

  /** Standalone join with its own transaction and P2002 race mapping. */
  async joinHome(
    homeId: string,
    userId: string,
    role: HomeMemberRole = HomeMemberRole.PARTICIPANT,
  ) {
    await this.actionLimit(userId);
    try {
      const membership = await this.prisma.$transaction((tx) =>
        this.joinHomeInTx(tx, homeId, userId, role),
      );
      this.logger.log(
        `home.member.joined home=${homeId} user=${userId} role=${role}`,
      );
      const members = await this.prisma.homeMembership.findMany({
        where: { homeId },
        select: { userId: true },
      });
      void this.fanout.publishUserEvent(
        members.map((m) => m.userId),
        'home:changed',
      );
      return membership;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('ALREADY_IN_HOME');
      }
      throw error;
    }
  }

  /**
   * Explicit leave (spec #44). Participants just leave; the owner leaving
   * destroys the whole Home.
   */
  async leaveHome(userId: string) {
    await this.actionLimit(userId);
    const membership = await this.prisma.homeMembership.findUnique({
      where: { userId },
    });
    this.policy.assertCanLeave(membership?.homeId ?? null);
    if (!membership) {
      throw new ForbiddenException('NOT_HOME_MEMBER');
    }

    if (membership.role === HomeMemberRole.OWNER) {
      return this.homes.destroyHome(membership.homeId, userId);
    }

    const peers = await this.prisma.homeMembership.findMany({
      where: { homeId: membership.homeId },
      select: { userId: true },
    });
    await this.prisma.homeMembership.delete({ where: { userId } });
    this.logger.log(`home.member.left home=${membership.homeId} user=${userId}`);
    void this.fanout.publishUserEvent(
      peers.map((m) => m.userId),
      'home:changed',
    );
    return { homeId: membership.homeId, userId };
  }

  /** Owner-only removal (spec #45). Removed users lose voice access. */
  async removeMember(homeId: string, requesterId: string, targetUserId: string) {
    await this.actionLimit(requesterId);
    const [requester, target] = await Promise.all([
      this.prisma.homeMembership.findUnique({
        where: { userId: requesterId },
      }),
      this.prisma.homeMembership.findUnique({
        where: { userId: targetUserId },
      }),
    ]);

    this.policy.assertCanRemove({
      requesterId,
      requesterRole: requester?.role ?? HomeMemberRole.PARTICIPANT,
      requesterHomeId: requester?.homeId ?? null,
      targetHomeId: target?.homeId ?? null,
      targetUserId,
    });

    if (!target || target.homeId !== homeId || requester?.homeId !== homeId) {
      throw new ForbiddenException('NOT_HOME_MEMBER');
    }

    const peers = await this.prisma.homeMembership.findMany({
      where: { homeId },
      select: { userId: true },
    });
    await this.prisma.homeMembership.delete({
      where: { userId: targetUserId },
    });

    // The removed client may not cooperate, so the server force-disconnects
    // it from the SFU room. Fail-open: membership removal already committed
    // and rejoin is impossible without membership (spec #59).
    try {
      await this.voice.removeVoiceParticipant(homeId, targetUserId);
    } catch (error) {
      this.logger.warn(
        `home.voice.remove failed home=${homeId} user=${targetUserId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    this.logger.log(
      `home.member.removed home=${homeId} target=${targetUserId} by=${requesterId}`,
    );
    void this.fanout.publishUserEvent(
      peers.map((m) => m.userId),
      'home:changed',
    );
    return { homeId, userId: targetUserId };
  }
}
