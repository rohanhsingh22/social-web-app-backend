import { IsHexColor, IsIn, IsObject, IsOptional } from 'class-validator';

export class UpdateUserSettingsDto {
  @IsOptional()
  @IsIn(['light', 'dark', 'system'])
  theme?: 'light' | 'dark' | 'system';

  @IsOptional()
  @IsHexColor()
  accentColor?: string;

  @IsOptional()
  @IsObject()
  profileVisibility?: Record<string, boolean>;
}
