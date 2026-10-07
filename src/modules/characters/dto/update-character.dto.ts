import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateCharacterDto {
  @IsString()
  @MaxLength(64)
  characterId!: string;

  @IsOptional()
  @IsObject()
  loadout?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accessoryIds?: string[];
}
