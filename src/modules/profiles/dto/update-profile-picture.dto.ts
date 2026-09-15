import {
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateProfilePictureDto {
  @IsString()
  @IsIn(['provider', 'toli'])
  type: 'provider' | 'toli';

  @ValidateIf((o: UpdateProfilePictureDto) => o.type === 'toli')
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  avatarKey?: string;
}
