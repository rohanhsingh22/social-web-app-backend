import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ReportStatus } from '@prisma/client';

/**
 * Phase 3: concurrency-safe resolve. Only `resolved`/`rejected` are accepted
 * here (claim moves `open` → `reviewing`). `reason` is mandatory and audited.
 * `expectedReviewedAt` enables compare-and-swap: if the case was claimed or
 * resolved after the UI loaded, the write fails with 409 STALE_CASE_VERSION.
 */
export class AdminCaseResolveDto {
  @IsEnum(ReportStatus)
  status!: ReportStatus;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsISO8601()
  expectedReviewedAt?: string;
}
