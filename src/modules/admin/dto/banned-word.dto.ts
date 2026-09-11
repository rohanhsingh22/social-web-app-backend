import { BannedWordSeverity } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBannedWordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  word!: string;

  @IsOptional()
  @IsEnum(BannedWordSeverity)
  severity?: BannedWordSeverity;
}

export class UpdateBannedWordDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  word?: string;

  @IsOptional()
  @IsEnum(BannedWordSeverity)
  severity?: BannedWordSeverity;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
