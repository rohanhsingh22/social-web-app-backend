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
  HomeInvitationStatus,
  HomeMemberRole,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { RateLimitService } from '@app/common/rate-limit.service';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { FanoutService } from '@app/realtime/fanout/fanout.service';
import { PresenceService } from '@app/realtime/presence/presence.service';
import {
  HOME_INVITE_RATE_LIMIT,
  HOME_INVITE_RATE_WINDOW_SECONDS,
  HOME_ACTION_RATE_LIMIT,
  HOME_ACTION_RATE_WINDOW_SECONDS,
  MAX_PENDING_INVITATIONS_PER_HOME,
} from './home.constants';
import { buildInvitationExpiry, isExpired } from './home.policy';
import { HomePolicyService } from './home-policy.service';
import { HomeMembershipService } from './home-membership.service';
import { HomeService } from './home.service';

/**
 * Home invitations (Phase 3).
 * Any member can invite a connection; invites live 20s server-side and never
 * reserve capacity — capacity is enforced transactionally at accept time so
 * a pending invite can become valid again (spec #10) or fail HOME_FULL (#9).
 */
@Injectable()
export class HomeInvitationService {
  private readonly logger = new Logger(HomeInvitationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly homes: HomeService,
    private readonly memberships: HomeMembershipService,
    private readonly policy: HomePolicyService,
    private readonly presence: PresenceService,
    private readonly rateLimit: RateLimitService,
    private readonly fanout: FanoutService,
  ) {}

  async createInvitation(inviterId: string, inviteeId: string) {
    if (inviterId === inviteeId) {
      throw new BadRequestException('CANNOT_INVITE_SELF');
    }

    await this.rateLimit.assertAllowed(
      `home:invite:rate:${inviterId}`,
      HOME_INVITE_RATE_LIMIT,
      HOME_INVITE_RATE_WINDOW_SECONDS,
    );

    const [inviter, invitee] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: inviterId },
        select: { id: true, status: true },
      }),
      this.prisma.user.findUnique({
        where: { id: inviteeId },
        select: { id: true, status: true },
      }),
    ]);

    if (!inviter || inviter.status !== UserStatus.active) {
      throw new ForbiddenException('ACCOUNT_NOT_ALLOWED');
    }
    if (!invitee || invitee.status === UserStatus.deleted) {
      throw new NotFoundException('USER_NOT_FOUND');
    }
    if (invitee.status === UserStatus.banned) {
      throw new ForbiddenException('USER_UNAVAILABLE');
    }

    const inviteeMembership = await this.prisma.homeMembership.findUnique({
      where: { userId: inviteeId },
    });
    // First invite bootstraps the inviter's Home (spec #17); otherwise the
    // existing Home is reused. Inviting never fails for being homeless.
    const home = await this.homes.ensureHomeForUser(inviterId);
    this.policy.assertCanInvite({
      inviterHomeId: home.id,
      inviteeHomeId: inviteeMembership?.homeId ?? null,
    });

    const { userLowId, userHighId } = this.normalizedPair(inviterId, inviteeId);
    const connection = await this.prisma.connection.findUnique({
      where: { userLowId_userHighId: { userLowId, userHighId } },
    });
    if (!connection || connection.status !== ConnectionStatus.accepted) {
      throw new ForbiddenException('NOT_A_CONNECTION');
    }

    if (!(await this.presence.isUserOnline(inviteeId))) {
      throw new ConflictException('TARGET_OFFLINE');
    }

    const [pendingInHome, duplicate] = await Promise.all([
      this.prisma.homeInvitation.count({
        where: { homeId: home.id, status: HomeInvitationStatus.PENDING },
      }),
      this.prisma.homeInvitation.findFirst({
        where: {
          homeId: home.id,
          inviteeId,
          status: HomeInvitationStatus.PENDING,
        },
      }),
    ]);
    if (duplicate) {
      throw new ConflictException('INVITATION_ALREADY_PENDING');
    }
    if (pendingInHome >= MAX_PENDING_INVITATIONS_PER_HOME) {
      throw new ConflictException('INVITATION_LIMIT_REACHED');
    }

    const invitation = await this.prisma.homeInvitation.create({
      data: {
        homeId: home.id,
        inviterId,
        inviteeId,
        status: HomeInvitationStatus.PENDING,
        expiresAt: buildInvitationExpiry(),
      },
    });

    this.logger.log(
      `home.invitation.created home=${home.id} inviter=${inviterId} invitee=${inviteeId}`,
    );
    void this.fanout.publishUserEvent(
      [inviterId, inviteeId],
      'home:invitation:new',
      {
        invitation: {
          id: invitation.id,
          homeId: invitation.homeId,
          inviterId,
          inviteeId,
          expiresAt: invitation.expiresAt.toISOString(),
        },
      },
    );
    return invitation;
  }

  async acceptInvitation(userId: string, invitationId: string) {
    await this.rateLimit.assertAllowed(
      `home:actions:rate:${userId}`,
      HOME_ACTION_RATE_LIMIT,
      HOME_ACTION_RATE_WINDOW_SECONDS,
    );
    const invitation = await this.prisma.homeInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation) {
      throw new NotFoundException('INVITATION_NOT_FOUND');
    }
    if (invitation.inviteeId !== userId) {
      throw new ForbiddenException('INVITATION_ACTION_NOT_ALLOWED');
    }
    if (invitation.status !== HomeInvitationStatus.PENDING) {
      throw new ConflictException('INVITATION_ALREADY_RESPONDED');
    }
    if (isExpired(invitation.expiresAt)) {
      await this.markExpired(invitation.id);
      throw new ConflictException('INVITATION_EXPIRED');
    }

    // Inviter must still belong to the Home, otherwise the invite no longer
    // represents that Home. Cancelled outside the accept transaction below
    // so the status change is not rolled back with the throw.
    const inviterMembership = await this.prisma.homeMembership.findUnique({
      where: { userId: invitation.inviterId },
    });
    if (!inviterMembership || inviterMembership.homeId !== invitation.homeId) {
      await this.markCancelled(invitation.id);
      throw new ConflictException('INVITATION_EXPIRED');
    }

    let homeId: string;
    try {
      homeId = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.homeInvitation.findUnique({
          where: { id: invitationId },
        });
        if (!fresh) {
          throw new NotFoundException('INVITATION_NOT_FOUND');
        }
        if (fresh.status !== HomeInvitationStatus.PENDING) {
          throw new ConflictException('INVITATION_ALREADY_RESPONDED');
        }
        if (isExpired(fresh.expiresAt)) {
          throw new ConflictException('INVITATION_EXPIRED');
        }
        const home = await tx.home.findUnique({
          where: { id: fresh.homeId },
        });
        if (!home) {
          throw new NotFoundException('HOME_DESTROYED');
        }
        const inviterStillThere = await tx.homeMembership.findUnique({
          where: { userId: fresh.inviterId },
        });
        if (!inviterStillThere || inviterStillThere.homeId !== fresh.homeId) {
          throw new ConflictException('INVITATION_EXPIRED');
        }
        await this.memberships.joinHomeInTx(
          tx,
          fresh.homeId,
          userId,
          HomeMemberRole.PARTICIPANT,
        );
        await tx.homeInvitation.update({
          where: { id: invitationId },
          data: {
            status: HomeInvitationStatus.ACCEPTED,
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
      `home.invitation.accepted home=${homeId} invitee=${userId}`,
    );
    void this.fanout.publishUserEvent(
      home.memberships.map((m) => m.userId),
      'home:changed',
    );
    return home;
  }

  async rejectInvitation(userId: string, invitationId: string) {
    await this.rateLimit.assertAllowed(
      `home:actions:rate:${userId}`,
      HOME_ACTION_RATE_LIMIT,
      HOME_ACTION_RATE_WINDOW_SECONDS,
    );
    const invitation = await this.prisma.homeInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation) {
      throw new NotFoundException('INVITATION_NOT_FOUND');
    }
    if (invitation.inviteeId !== userId) {
      throw new ForbiddenException('INVITATION_ACTION_NOT_ALLOWED');
    }
    if (invitation.status !== HomeInvitationStatus.PENDING) {
      throw new ConflictException('INVITATION_ALREADY_RESPONDED');
    }
    if (isExpired(invitation.expiresAt)) {
      await this.markExpired(invitation.id);
      throw new ConflictException('INVITATION_EXPIRED');
    }

    const rejected = await this.prisma.homeInvitation.update({
      where: { id: invitationId },
      data: {
        status: HomeInvitationStatus.REJECTED,
        respondedAt: new Date(),
      },
    });

    this.logger.log(
      `home.invitation.rejected home=${invitation.homeId} invitee=${userId}`,
    );
    void this.fanout.publishUserEvent(
      [invitation.inviterId, userId],
      'home:changed',
    );
    return rejected;
  }

  /** Bulk sweep for a future worker schedule; also covered lazily. */
  async expireStaleInvitations(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.homeInvitation.updateMany({
      where: {
        status: HomeInvitationStatus.PENDING,
        expiresAt: { lte: now },
      },
      data: {
        status: HomeInvitationStatus.EXPIRED,
        respondedAt: now,
      },
    });
    if (result.count > 0) {
      this.logger.log(`home.invitation.expired count=${result.count}`);
    }
    return result.count;
  }

  private async markExpired(invitationId: string): Promise<void> {
    await this.prisma.homeInvitation.update({
      where: { id: invitationId },
      data: {
        status: HomeInvitationStatus.EXPIRED,
        respondedAt: new Date(),
      },
    });
  }

  private async markCancelled(invitationId: string): Promise<void> {
    await this.prisma.homeInvitation.update({
      where: { id: invitationId },
      data: {
        status: HomeInvitationStatus.CANCELLED,
        respondedAt: new Date(),
      },
    });
  }

  private normalizedPair(firstUserId: string, secondUserId: string) {
    const [userLowId, userHighId] = [firstUserId, secondUserId].sort();
    return { userLowId, userHighId };
  }
}
