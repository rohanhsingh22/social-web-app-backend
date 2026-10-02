import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Phase 4: single-recipient legal-notice history. Cursor is an opaque ISO
 * timestamp (`createdAt DESC, id DESC`). Bulk/scheduled campaigns remain
 * deferred — this lists what `POST /admin/legal-notices` actually sent.
 */
export class AdminNoticesQueryDto {
  @IsOptional()
  @IsISO8601()
  cursor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  limit?: string;
}
