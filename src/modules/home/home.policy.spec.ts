import {
  HOME_INVITATION_TTL_SECONDS,
  HOME_JOIN_REQUEST_TTL_SECONDS,
  MAX_HOME_MEMBERS,
} from './home.constants';
import { HOME_ERROR_CODES } from './home.errors';
import {
  buildInvitationExpiry,
  buildJoinRequestExpiry,
  hasHomeSlot,
  isExpired,
  isHomeFull,
  isOwner,
} from './home.policy';

describe('Home domain foundation (Phase 1)', () => {
  it('caps Homes at four members with no slot reservation', () => {
    expect(MAX_HOME_MEMBERS).toBe(4);
    expect(isHomeFull(3)).toBe(false);
    expect(isHomeFull(4)).toBe(true);
    expect(isHomeFull(5)).toBe(true);
    expect(hasHomeSlot(3)).toBe(true);
    expect(hasHomeSlot(4)).toBe(false);
  });

  it('keeps invitation and join-request TTLs at 20 seconds', () => {
    expect(HOME_INVITATION_TTL_SECONDS).toBe(20);
    expect(HOME_JOIN_REQUEST_TTL_SECONDS).toBe(20);

    const from = new Date('2026-10-05T00:00:00.000Z');
    expect(buildInvitationExpiry(from)).toEqual(
      new Date('2026-10-05T00:00:20.000Z'),
    );
    expect(buildJoinRequestExpiry(from)).toEqual(
      new Date('2026-10-05T00:00:20.000Z'),
    );
  });

  it('treats expiry as server-authoritative time comparison', () => {
    const now = new Date('2026-10-05T00:00:20.000Z');
    expect(isExpired(new Date('2026-10-05T00:00:19.999Z'), now)).toBe(true);
    expect(isExpired(new Date('2026-10-05T00:00:20.000Z'), now)).toBe(true);
    expect(isExpired(new Date('2026-10-05T00:00:20.001Z'), now)).toBe(false);
  });

  it('distinguishes owner from participant', () => {
    expect(isOwner('OWNER')).toBe(true);
    expect(isOwner('PARTICIPANT')).toBe(false);
  });

  it('exposes stable error codes for frontend mapping', () => {
    expect(HOME_ERROR_CODES).toContain('HOME_FULL');
    expect(HOME_ERROR_CODES).toContain('USER_ALREADY_IN_ANOTHER_HOME');
    expect(HOME_ERROR_CODES).toContain('INVITATION_EXPIRED');
    expect(HOME_ERROR_CODES).toContain('JOIN_REQUEST_EXPIRED');
    expect(new Set(HOME_ERROR_CODES).size).toBe(HOME_ERROR_CODES.length);
  });
});
