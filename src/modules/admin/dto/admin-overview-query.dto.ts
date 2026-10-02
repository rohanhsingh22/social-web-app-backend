import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Phase 2: bounded overview range. UTC transport; omitted range defaults to
 * the trailing 30 days. Ranges longer than 366 days are rejected so no
 * request can force a full-table aggregation.
 */
export class AdminOverviewQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
