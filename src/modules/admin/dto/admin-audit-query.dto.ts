import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Phase 2: bounded audit-trail query. Same cursor contract as the user
 * directory (`createdAt DESC, id DESC`). Moderators are scoped to their own
 * `actorId` in the service layer regardless of the requested filter.
 */
export class AdminAuditQueryDto {
  @IsOptional()
  @IsUUID('4')
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsISO8601()
  cursor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  limit?: string;
}
