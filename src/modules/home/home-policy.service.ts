import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MAX_HOME_MEMBERS } from './home.constants';
import type { HomeMemberRoleName } from './home.types';

/**
 * Reusable Home rules (Phase 2).
 * Pure assertions over caller-supplied state — no Prisma here so Phase 3/4
 * (invitations, join requests) can reuse the same checks. throwing keeps
 * call sites small and error codes stable for the frontend.
 */
@Injectable()
export class HomePolicyService {
  /** Joining requires no existing membership and a free slot. */
  assertCanJoin(
    requesterHomeId: string | null,
    memberCount: number,
  ): void {
    if (requesterHomeId) {
      throw new ConflictException('ALREADY_IN_HOME');
    }
    if (memberCount >= MAX_HOME_MEMBERS) {
      throw new ConflictException('HOME_FULL');
    }
  }

  /** Leaving requires an existing membership (owner or participant). */
  assertCanLeave(membershipHomeId: string | null): void {
    if (!membershipHomeId) {
      throw new ForbiddenException('NOT_HOME_MEMBER');
    }
  }

  /** Only the owner can remove, only within the same Home, never self. */
  assertCanRemove(params: {
    requesterId: string;
    requesterRole: HomeMemberRoleName;
    requesterHomeId: string | null;
    targetHomeId: string | null;
    targetUserId: string;
  }): void {
    if (!params.requesterHomeId) {
      throw new ForbiddenException('NOT_HOME_MEMBER');
    }
    if (params.requesterRole !== 'OWNER') {
      throw new ForbiddenException('NOT_HOME_OWNER');
    }
    if (params.requesterId === params.targetUserId) {
      throw new BadRequestException('CANNOT_REMOVE_SELF');
    }
    if (!params.targetHomeId || params.targetHomeId !== params.requesterHomeId) {
      throw new ForbiddenException('NOT_HOME_MEMBER');
    }
  }

  /**
   * Inviting never reserves capacity (spec Rule 10), so only membership
   * placement is checked here. Capacity is enforced at accept time.
   */
  assertCanInvite(params: {
    inviterHomeId: string | null;
    inviteeHomeId: string | null;
  }): void {
    if (!params.inviterHomeId) {
      throw new ForbiddenException('NOT_HOME_MEMBER');
    }
    if (params.inviteeHomeId) {
      if (params.inviteeHomeId === params.inviterHomeId) {
        throw new ConflictException('ALREADY_IN_HOME');
      }
      throw new ConflictException('USER_ALREADY_IN_ANOTHER_HOME');
    }
  }

  /** Acceptance rechecks one-home rule plus current capacity. */
  assertCanAccept(
    inviteeHomeId: string | null,
    memberCount: number,
  ): void {
    if (inviteeHomeId) {
      throw new ConflictException('ALREADY_IN_HOME');
    }
    if (memberCount >= MAX_HOME_MEMBERS) {
      throw new ConflictException('HOME_FULL');
    }
  }

  /**
   * Join requests resolve the Home through the target member (spec #42-43):
   * the requester must be homeless and the target must be an active member.
   * Capacity is intentionally not checked here — creation rejects full Homes
   * while acceptance rechecks via assertCanAccept.
   */
  assertCanRequestJoin(params: {
    requesterHomeId: string | null;
    targetHomeId: string | null;
  }): void {
    if (params.requesterHomeId) {
      throw new ConflictException('ALREADY_IN_HOME');
    }
    if (!params.targetHomeId) {
      throw new ConflictException('TARGET_HAS_NO_HOME');
    }
  }
}
