import { IsString, MaxLength, MinLength } from 'class-validator';

export class AdminActionDto {
  // Phase 1: reason is mandatory on all consequential admin operations so
  // every audit event carries human justification.
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
