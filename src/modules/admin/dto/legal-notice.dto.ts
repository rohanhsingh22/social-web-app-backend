import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class LegalNoticeDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;
}
