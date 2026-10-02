import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { UserRole, UserStatus } from '@prisma/client';

/**
 * Phase 2: bounded user directory query. Cursor is an opaque ISO timestamp
 * (the previous page's last `createdAt`); service orders by
 * `createdAt DESC, id DESC` and returns `{ items, nextCursor, hasMore }`.
 * Search covers displayName/username (case-insensitive contains) and
 * publicUserId (exact, normalized). Provider emails are never searchable.
 */
export class AdminUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsISO8601()
  cursor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  limit?: string;
}
