import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest } from '@app/modules/auth/auth.guard';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;

    if (role === UserRole.admin || role === UserRole.moderator) {
      return true;
    }

    throw new ForbiddenException('ADMIN_REQUIRED');
  }
}
