import { IsOptional, IsUUID } from 'class-validator';

export class MarkAllReadDto {
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}
