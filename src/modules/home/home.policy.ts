import {
  HOME_INVITATION_TTL_SECONDS,
  HOME_JOIN_REQUEST_TTL_SECONDS,
  MAX_HOME_MEMBERS,
} from './home.constants';
import type { HomeMemberRoleName } from './home.types';

/**
 * Pure Home invariant helpers (Phase 1 foundation).
 * No Prisma, no Nest, no I/O — safe to unit test and reuse in Phase 2 services.
 * Spec rules: max 4 members, capacity checked at accept time, 20s TTLs.
 */
export function isHomeFull(memberCount: number): boolean {
  return memberCount >= MAX_HOME_MEMBERS;
}

export function hasHomeSlot(memberCount: number): boolean {
  return memberCount < MAX_HOME_MEMBERS;
}

export function isOwner(role: HomeMemberRoleName): boolean {
  return role === 'OWNER';
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function buildInvitationExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + HOME_INVITATION_TTL_SECONDS * 1000);
}

export function buildJoinRequestExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + HOME_JOIN_REQUEST_TTL_SECONDS * 1000);
}
