import { IsString, MaxLength, MinLength } from 'class-validator';

export class CheckDisplayNameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  displayName: string;
}
