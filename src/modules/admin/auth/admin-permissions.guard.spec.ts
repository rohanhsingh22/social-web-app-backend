import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminPermissionsGuard } from './admin-permissions.guard';
import { ADMIN_PERMISSIONS_KEY } from './require-permissions.decorator';

describe('AdminPermissionsGuard', () => {
  const createGuard = (permissions: string[] | undefined, role?: string) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(permissions),
    } as unknown as Reflector;
    const guard = new AdminPermissionsGuard(reflector);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ admin: role ? { role } : undefined }),
      }),
    } as unknown as ExecutionContext;
    return { guard, context, reflector };
  };

  it('allows unguarded routes without checking a role', () => {
    const { guard, context } = createGuard(undefined, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows moderators their queue permissions', () => {
    const { guard, context, reflector } = createGuard(
      ['reports.read'],
      'moderator',
    );
    expect(guard.canActivate(context)).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      ADMIN_PERMISSIONS_KEY,
      expect.anything(),
    );
  });

  it('denies moderators owner/admin-only actions', () => {
    const { guard, context } = createGuard(['users.ban'], 'moderator');
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('denies admins staff management', () => {
    const { guard, context } = createGuard(['staff.manage'], 'admin');
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('denies unauthenticated callers on guarded routes', () => {
    const { guard, context } = createGuard(['reports.read'], undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
