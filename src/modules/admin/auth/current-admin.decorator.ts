import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AdminAuthenticatedRequest } from './admin-auth.guard';

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AdminAuthenticatedRequest>().admin,
);
