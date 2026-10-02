import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Phase 5: bounded analytics ranges. UTC transport; omitted range defaults to
 * the trailing 30 days. Series endpoints cap at 92 days so no request can
 * force a full-table aggregation. Granularity is day or week (UTC buckets).
 */
export class AdminAnalyticsQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  granularity?: string;
}
