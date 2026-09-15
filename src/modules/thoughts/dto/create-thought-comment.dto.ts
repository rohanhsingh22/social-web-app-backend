import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateThoughtCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;
}
