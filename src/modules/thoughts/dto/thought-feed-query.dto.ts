import { IsOptional, IsString } from 'class-validator';

export class ThoughtFeedQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
