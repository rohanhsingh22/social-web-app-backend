import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Phase 5: failed-job browser. Cursor is an opaque ISO timestamp of the
 * job's failure time; payloads are never returned (redacted summaries only).
 */
export class AdminFailedJobsQueryDto {
  @IsOptional()
  @IsISO8601()
  cursor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  limit?: string;
}
