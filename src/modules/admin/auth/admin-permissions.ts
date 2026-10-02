import { UserRole } from '@prisma/client';

// Granular admin permissions (Master Plan §4). Backend is the authority; the
// admin frontend mirrors this matrix for nav visibility only.
export const ADMIN_PERMISSIONS = [
  'overview.read',
  'users.read',
  'users.mute',
  'users.ban',
  'reports.read',
  'reports.assign',
  'reports.resolve',
  'content.remove',
  'channels.read',
  'channels.write',
  'toli.system.read',
  'toli.system.write',
  'dictionary.write',
  'notices.publish',
  'audit.read',
  'ops.read',
  'staff.manage',
  'ai.use',
  'ai.configure',
  'analytics.read',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const STAFF_ROLES: readonly UserRole[] = [
  UserRole.owner,
  UserRole.admin,
  UserRole.moderator,
];

export function isStaffRole(role: unknown): role is UserRole {
  return (
    role === UserRole.owner ||
    role === UserRole.admin ||
    role === UserRole.moderator
  );
}

const ROLE_PERMISSIONS: Record<UserRole, readonly AdminPermission[]> = {
  [UserRole.owner]: [...ADMIN_PERMISSIONS],
  [UserRole.admin]: [
    'overview.read',
    'users.read',
    'users.mute',
    'users.ban',
    'reports.read',
    'reports.assign',
    'reports.resolve',
    'content.remove',
    'channels.read',
    'channels.write',
    'toli.system.read',
    'notices.publish',
    'audit.read',
    'dictionary.write',
    'ai.use',
    'analytics.read',
    'ops.read',
  ],
  [UserRole.moderator]: [
    'overview.read',
    'users.read',
    'users.mute',
    'reports.read',
    'reports.assign',
    'reports.resolve',
    'content.remove',
    'ai.use',
  ],
  [UserRole.user]: [],
};

export function permissionsForRole(role: UserRole): AdminPermission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function hasAdminPermission(
  role: UserRole | null | undefined,
  permission: AdminPermission,
): boolean {
  if (!role) {
    return false;
  }
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

/** owner 3 > admin 2 > moderator 1 > user 0. Used for staff hierarchy checks. */
export function roleRank(role: UserRole): number {
  switch (role) {
    case UserRole.owner:
      return 3;
    case UserRole.admin:
      return 2;
    case UserRole.moderator:
      return 1;
    default:
      return 0;
  }
}
