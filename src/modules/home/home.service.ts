import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConnectionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { FanoutService } from '@app/realtime/fanout/fanout.service';
import { CharactersService } from '@app/modules/characters/characters.service';
import { HomePresenceService } from './home-presence.service';
import { HomeVoiceService } from './voice/home-voice.service';

/**
 * Home lifecycle + reads (Phase 2 lifecycle, Phase 5 reads).
 * Owns: create/find, read, destroy. Membership joins/leaves live in
 * HomeMembershipService to keep this file small (spec #25).
 */
@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fanout: FanoutService,
    private readonly homePresence: HomePresenceService,
    private readonly voice: HomeVoiceService,
    private readonly characters: CharactersService,
  ) {}

  /**
   * Ensure the user has a Home, creating one with an OWNER membership on
   * first use (spec #17). Safe under concurrent calls via P2002 retry.
   */
  async ensureHomeForUser(userId: string) {
    const existing = await this.prisma.homeMembership.findUnique({
      where: { userId },
      include: { home: { include: { memberships: true } } },
    });
    if (existing) {
      return existing.home;
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const home = await tx.home.create({
          data: { ownerId: userId },
        });
        await tx.homeMembership.create({
          data: { homeId: home.id, userId, role: 'OWNER' },
        });
        return tx.home.findUniqueOrThrow({
          where: { id: home.id },
          include: { memberships: true },
        });
      });

      this.logger.log(`home.created home=${created.id} owner=${userId}`);
      void this.fanout.publishUserEvent([userId], 'home:changed');
      return created;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const retry = await this.prisma.homeMembership.findUnique({
          where: { userId },
          include: { home: { include: { memberships: true } } },
        });
        if (retry) {
          return retry.home;
        }
      }
      throw error;
    }
  }

  /** Current user's Home with memberships, or null when homeless. */
  async getHomeForUser(userId: string) {
    const membership = await this.prisma.homeMembership.findUnique({
      where: { userId },
      include: { home: { include: { memberships: true } } },
    });
    return membership?.home ?? null;
  }

  async getHomeById(homeId: string) {
    const home = await this.prisma.home.findUnique({
      where: { id: homeId },
      include: { memberships: true },
    });
    if (!home) {
      throw new NotFoundException('HOME_NOT_FOUND');
    }
    return home;
  }

  /**
   * Render-ready Home state (spec #34-35). One call carries every member's
   * identity + characterConfig + presence, so the frontend never fetches
   * per-member profiles. characterConfig appears here only — never on
   * generic social surfaces (spec #36).
   */
  async getHomeState(userId: string) {
    const membership = await this.prisma.homeMembership.findUnique({
      where: { userId },
      include: {
        home: { include: { memberships: { orderBy: { joinedAt: 'asc' } } } },
      },
    });
    if (!membership) {
      return null;
    }

    const home = membership.home;
    const memberIds = home.memberships.map((m) => m.userId);
    const [users, presence] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: memberIds } },
        select: {
          id: true,
          publicUserId: true,
          profile: {
            select: { displayName: true, characterConfig: true },
          },
        },
      }),
      this.homePresence.presenceMap(memberIds),
    ]);

    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      id: home.id,
      ownerId: home.ownerId,
      memberCount: home.memberships.length,
      members: home.memberships.map((m) => {
        const rawConfig = (byId.get(m.userId)?.profile?.characterConfig ??
          null) as Record<string, unknown> | null;
        return {
          userId: m.userId,
          publicUserId: byId.get(m.userId)?.publicUserId ?? null,
          displayName: byId.get(m.userId)?.profile?.displayName ?? 'Someone',
          role: m.role,
          presence: presence.get(m.userId) ?? 'offline',
          // Legacy field kept for backward compat — frontend prefers
          // `character` when present.
          characterConfig: rawConfig,
          character: this.toResolvedCharacter(rawConfig),
          joinedAt: m.joinedAt,
        };
      }),
    };
  }

  /**
   * Home-aware connection list (spec #37-38). homeState is AVAILABLE when
   * the target has no Home, MY_HOME for same-Home members, OTHER_HOME with
   * a member count otherwise. Offline rendering comes from `presence`,
   * which is orthogonal (an offline user can still be AVAILABLE).
   */
  async getHomeConnections(viewerId: string) {
    const viewerMembership = await this.prisma.homeMembership.findUnique({
      where: { userId: viewerId },
    });
    const viewerHomeId = viewerMembership?.homeId ?? null;

    const connections = await this.prisma.connection.findMany({
      where: {
        status: ConnectionStatus.accepted,
        OR: [{ requesterId: viewerId }, { receiverId: viewerId }],
      },
      select: { requesterId: true, receiverId: true },
    });
    const targetIds = [
      ...new Set(
        connections.map((c) =>
          c.requesterId === viewerId ? c.receiverId : c.requesterId,
        ),
      ),
    ];
    if (targetIds.length === 0) {
      return [];
    }

    const [users, memberships, presence] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: targetIds } },
        select: {
          id: true,
          publicUserId: true,
          profile: {
            select: { displayName: true, characterConfig: true },
          },
        },
      }),
      this.prisma.homeMembership.findMany({
        where: { userId: { in: targetIds } },
        select: { userId: true, homeId: true },
      }),
      this.homePresence.presenceMap(targetIds),
    ]);

    const homeByUser = new Map(memberships.map((m) => [m.userId, m.homeId]));
    const homeIds = [...new Set(memberships.map((m) => m.homeId))];
    const counts =
      homeIds.length > 0
        ? await this.prisma.homeMembership.groupBy({
            by: ['homeId'],
            where: { homeId: { in: homeIds } },
            _count: { homeId: true },
          })
        : [];
    const countByHome = new Map(
      counts.map((c) => [c.homeId, c._count.homeId]),
    );
    const byId = new Map(users.map((u) => [u.id, u]));

    return targetIds.map((targetId) => {
      const targetHomeId = homeByUser.get(targetId) ?? null;
      let homeState: 'AVAILABLE' | 'MY_HOME' | 'OTHER_HOME' = 'AVAILABLE';
      if (targetHomeId) {
        homeState =
          viewerHomeId && targetHomeId === viewerHomeId
            ? 'MY_HOME'
            : 'OTHER_HOME';
      }
      const rawConfig = (byId.get(targetId)?.profile?.characterConfig ??
        null) as Record<string, unknown> | null;
      return {
        userId: targetId,
        publicUserId: byId.get(targetId)?.publicUserId ?? null,
        displayName: byId.get(targetId)?.profile?.displayName ?? 'Someone',
        characterConfig: rawConfig,
        character: this.toResolvedCharacter(rawConfig),
        presence: presence.get(targetId) ?? 'offline',
        homeState,
        homeMemberCount:
          homeState === 'OTHER_HOME' && targetHomeId
            ? (countByHome.get(targetHomeId) ?? 0)
            : null,
      };
    });
  }

  /**
   * Owner-only destroy (spec #44). Home row deletion cascades to
   * memberships/invitations/requests. Returns affected users for fanout.
   */
  async destroyHome(homeId: string, actorId: string) {
    const home = await this.prisma.home.findUnique({
      where: { id: homeId },
      include: { memberships: true },
    });
    if (!home) {
      throw new NotFoundException('HOME_NOT_FOUND');
    }

    const actor = home.memberships.find((m) => m.userId === actorId);
    if (!actor) {
      throw new ForbiddenException('NOT_HOME_MEMBER');
    }
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('NOT_HOME_OWNER');
    }

    const removedUserIds = home.memberships.map((m) => m.userId);
    try {
      await this.prisma.home.delete({ where: { id: homeId } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('HOME_NOT_FOUND');
      }
      throw error;
    }

    // Voice teardown is fail-open: the Home is already destroyed, and an SFU
    // outage must never resurrect it or fail the request (spec #57-58).
    try {
      await this.voice.closeVoiceHome(homeId);
    } catch (error) {
      this.logger.warn(
        `home.voice.close failed home=${homeId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    this.logger.log(`home.destroyed home=${homeId} by=${actorId}`);
    void this.fanout.publishUserEvent(removedUserIds, 'home:changed');
    return { homeId, removedUserIds };
  }

  /**
   * Best-effort resolve of legacy/typed characterConfig JSON into a validated
   * definition + loadout. Never throws — Home reads must not 500 on corrupt
   * character data; callers fall back to the default character.
   */
  private toResolvedCharacter(
    rawConfig: Record<string, unknown> | null,
  ): { definitionId: string; loadout: Record<string, unknown> } | null {
    if (!rawConfig) {
      return null;
    }
    try {
      const characterId =
        typeof rawConfig.characterId === 'string'
          ? rawConfig.characterId
          : undefined;
      const loadout =
        rawConfig.loadout && typeof rawConfig.loadout === 'object'
          ? (rawConfig.loadout as Record<string, unknown>)
          : rawConfig;
      if (!characterId) {
        return null;
      }
      const resolved = this.characters.resolveCharacter(characterId, loadout);
      return {
        definitionId: resolved.definition.id,
        loadout: resolved.loadout as unknown as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  }
}
