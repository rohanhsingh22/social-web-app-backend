import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAdminPermission } from './admin-permissions';
import { ADMIN_PERMISSIONS_KEY } from './require-permissions.decorator';
import { AdminAuthenticatedRequest } from './admin-auth.guard';
import type { AdminPermission } from './admin-permissions';

/** Enforces @RequirePermissions() after AdminAuthGuard resolved request.admin. */
@Injectable()
export class AdminPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<AdminPermission[]>(
        ADMIN_PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? [];

    if (required.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    const role = request.admin?.role;

    for (const permission of required) {
      if (!hasAdminPermission(role, permission)) {
        throw new ForbiddenException('ADMIN_PERMISSION_REQUIRED');
      }
    }
    return true;
  }
}
