// Hirotoli Home domain types (Phase 1 foundation).
// Mirror the Prisma enums without importing the generated client so pure
// domain helpers stay dependency-free. Values must match schema.prisma.

export type HomeMemberRoleName = 'OWNER' | 'PARTICIPANT';

export type HomeInvitationStatusName =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED';

export type HomeJoinRequestStatusName =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED';

// Frontend connection states for GET /home/connections (spec #38).
export type HomeConnectionState =
  | 'AVAILABLE'
  | 'OFFLINE'
  | 'MY_HOME'
  | 'OTHER_HOME';
