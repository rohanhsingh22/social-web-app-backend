import {
  IsIn,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export class MfaCodeDto {
  @IsString()
  @Length(6, 12)
  @Matches(/^[0-9\s-]+$/, { message: 'MFA_CODE_INVALID' })
  code!: string;
}

export class RoleChangeDto {
  @IsUUID('4', { message: 'USER_ID_INVALID' })
  userId!: string;

  @IsIn(['owner', 'admin', 'moderator', 'user'], { message: 'ROLE_INVALID' })
  role!: 'owner' | 'admin' | 'moderator' | 'user';
}

export class CreateInvitationDto {
  @IsUUID('4', { message: 'USER_ID_INVALID' })
  userId!: string;

  @IsIn(['owner', 'admin', 'moderator'], { message: 'ROLE_INVALID' })
  role!: 'owner' | 'admin' | 'moderator';
}

export class MfaResetDto {
  @IsUUID('4', { message: 'USER_ID_INVALID' })
  userId!: string;
}
