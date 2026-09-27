import { IsOptional, IsString } from 'class-validator';

export class ThoughtFeedQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  // For You pagination only: ranked-but-unserved ids carried forward so no
  // candidate is ever skipped. Comma-separated thought ids (capped server-side).
  @IsOptional()
  @IsString()
  deferred?: string;
}
