import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '@app/common/public.decorator';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './auth.types';

export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('AUTH_REQUIRED');
    }

    const start = Date.now();
    try {
      request.user = await this.authService.verifyAccessToken(token);
      return true;
    } finally {
      this.logger.debug(
        `AuthGuard verifyAccessToken ${(Date.now() - start).toFixed(1)}ms ${request.method} ${request.url}`,
      );
    }
  }

  private extractToken(request: Request): string | undefined {
    const authHeader = request.header('authorization');

    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length);
    }

    // Transitional fallback: access_token cookie is no longer issued, but
    // sessions created before Phase 1.4b still carry one until expiry.
    return request.cookies?.access_token;
  }
}
