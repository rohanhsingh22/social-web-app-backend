import { UserRole } from '@prisma/client';
import {
  ADMIN_PERMISSIONS,
  hasAdminPermission,
  isStaffRole,
  permissionsForRole,
  roleRank,
} from './admin-permissions';

describe('admin permission matrix (Master Plan §4)', () => {
  it('grants owners every permission', () => {
    expect(permissionsForRole(UserRole.owner)).toEqual(
      expect.arrayContaining([...ADMIN_PERMISSIONS]),
    );
    expect(permissionsForRole(UserRole.owner)).toHaveLength(
      ADMIN_PERMISSIONS.length,
    );
  });

  it('denies moderators bans, staff, channels, dictionary and ops', () => {
    expect(hasAdminPermission(UserRole.moderator, 'reports.read')).toBe(true);
    expect(hasAdminPermission(UserRole.moderator, 'reports.resolve')).toBe(true);
    expect(hasAdminPermission(UserRole.moderator, 'users.mute')).toBe(true);
    expect(hasAdminPermission(UserRole.moderator, 'content.remove')).toBe(true);
    expect(hasAdminPermission(UserRole.moderator, 'users.ban')).toBe(false);
    expect(hasAdminPermission(UserRole.moderator, 'channels.write')).toBe(false);
    expect(hasAdminPermission(UserRole.moderator, 'dictionary.write')).toBe(false);
    expect(hasAdminPermission(UserRole.moderator, 'notices.publish')).toBe(false);
    expect(hasAdminPermission(UserRole.moderator, 'audit.read')).toBe(false);
    expect(hasAdminPermission(UserRole.moderator, 'staff.manage')).toBe(false);
    expect(hasAdminPermission(UserRole.moderator, 'ops.read')).toBe(false);
  });

  it('denies admins staff management and protected Toli writes', () => {
    expect(hasAdminPermission(UserRole.admin, 'users.ban')).toBe(true);
    expect(hasAdminPermission(UserRole.admin, 'channels.write')).toBe(true);
    expect(hasAdminPermission(UserRole.admin, 'toli.system.read')).toBe(true);
    expect(hasAdminPermission(UserRole.admin, 'staff.manage')).toBe(false);
    expect(hasAdminPermission(UserRole.admin, 'toli.system.write')).toBe(false);
    expect(hasAdminPermission(UserRole.admin, 'ai.configure')).toBe(false);
  });

  it('grants plain users nothing and ranks roles owner > admin > moderator', () => {
    expect(permissionsForRole(UserRole.user)).toEqual([]);
    expect(hasAdminPermission(undefined, 'reports.read')).toBe(false);
    expect(roleRank(UserRole.owner)).toBeGreaterThan(roleRank(UserRole.admin));
    expect(roleRank(UserRole.admin)).toBeGreaterThan(
      roleRank(UserRole.moderator),
    );
    expect(isStaffRole(UserRole.owner)).toBe(true);
    expect(isStaffRole(UserRole.user)).toBe(false);
  });
});
