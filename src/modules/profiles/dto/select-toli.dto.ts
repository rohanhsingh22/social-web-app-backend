import { IsUUID, ValidateIf } from 'class-validator';

// Null = skip/leave Toli. A missing key is rejected: selection must be
// explicit, otherwise an empty body would silently wipe membership.
export class SelectToliDto {
  @ValidateIf((o: SelectToliDto) => o.toliId !== null)
  @IsUUID()
  toliId!: string | null;
}
