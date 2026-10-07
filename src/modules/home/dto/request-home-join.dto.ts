import { IsUUID } from 'class-validator';

export class RequestHomeJoinDto {
  @IsUUID()
  targetMemberId!: string;
}
