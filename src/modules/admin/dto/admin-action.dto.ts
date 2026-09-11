import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
