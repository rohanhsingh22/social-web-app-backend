import { IsString, MaxLength } from 'class-validator';

export class UnlockCharacterDto {
  @IsString()
  @MaxLength(64)
  characterId!: string;
}
