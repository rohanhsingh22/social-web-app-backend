import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest } from '@app/modules/auth/auth.guard';

/**
 * @deprecated Phase 1 retires the blanket guard from AdminController in favor
 * of AdminAuthGuard (isolated sessions) + AdminPermissionsGuard (per-route
 * permissions). Kept for compatibility; now also accepts the owner role.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;

    if (
      role === UserRole.owner ||
      role === UserRole.admin ||
      role === UserRole.moderator
    ) {
      return true;
    }

    throw new ForbiddenException('ADMIN_REQUIRED');
  }
}
