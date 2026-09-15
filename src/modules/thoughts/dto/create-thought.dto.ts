import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateThoughtDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body!: string;
}
