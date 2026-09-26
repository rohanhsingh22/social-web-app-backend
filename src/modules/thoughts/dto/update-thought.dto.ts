import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateThoughtDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body!: string;
}
