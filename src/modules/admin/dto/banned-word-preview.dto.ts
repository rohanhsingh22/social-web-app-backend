import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Phase 4: rule-preview test. Runs the same whole-word matching the
 * enforcement path (`ModerationService`) uses against the live active rule
 * set. No multilingual morphology is claimed — schema is word/severity/active
 * only, and matching is whole-word/phrase, case-insensitive.
 */
export class BannedWordPreviewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}
