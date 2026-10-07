import { IsUUID } from 'class-validator';

export class InviteToHomeDto {
  @IsUUID()
  inviteeId!: string;
}
