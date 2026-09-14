import { Transform } from "class-transformer";
import { IsString, Matches } from "class-validator";
import {
  PUBLIC_USER_ID_ALPHABET,
  PUBLIC_USER_ID_BODY_LENGTH,
  PUBLIC_USER_ID_PREFIX,
} from "@app/common/public-user-id";

const PUBLIC_USER_ID_PATTERN = `^${PUBLIC_USER_ID_PREFIX}[${PUBLIC_USER_ID_ALPHABET}]{${PUBLIC_USER_ID_BODY_LENGTH}}$`;

export class CreateConnectionRequestDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(new RegExp(PUBLIC_USER_ID_PATTERN))
  receiverUserId!: string;
}
