import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ReportStatus } from '@prisma/client';

/**
 * Phase 3: unified moderation inbox query. Merges `Report` + `ThoughtReport`
 * into cursor-paginated `{ items, nextCursor, hasMore }` ordered by
 * `createdAt DESC`. `state` maps 1:1 to `ReportStatus`; `type` selects the
 * normalized source; `assignee` filters by claiming reviewer.
 */
export class AdminCasesQueryDto {
  @IsOptional()
  @IsEnum(ReportStatus)
  state?: ReportStatus;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  type?: string;

  @IsOptional()
  @IsUUID('4')
  assignee?: string;

  @IsOptional()
  @IsISO8601()
  cursor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  limit?: string;
}
