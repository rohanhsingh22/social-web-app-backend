import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MessageStatus } from '@prisma/client';

/**
 * Phase 3: permission-scoped content lists. Thoughts support text search;
 * channel messages optionally scope to one channel. No DM listing endpoint
 * exists by design — reported DMs surface only as single-message evidence
 * inside their case. Cursor is an opaque ISO timestamp.
 */
export class AdminContentQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(MessageStatus)
  status?: MessageStatus;

  @IsOptional()
  @IsUUID('4')
  channelId?: string;

  @IsOptional()
  @IsISO8601()
  cursor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  limit?: string;
}
