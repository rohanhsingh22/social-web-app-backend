import { IsUUID } from "class-validator";

export class CreateConnectionRequestDto {
  @IsUUID()
  receiverUserId!: string;
}
