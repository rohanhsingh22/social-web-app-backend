import { ReportReason } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateReportDto {
  // Internal user UUID or public HiRotoli ID (HT-XXXXXXXX) — the service
  // resolves public IDs so profile/report UIs that only know the public ID
  // can file user reports.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  targetUserId?: string;

  @IsOptional()
  @IsUUID()
  targetChannelMessageId?: string;

  @IsOptional()
  @IsUUID()
  targetDirectMessageId?: string;

  @IsEnum(ReportReason)
  reason!: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}
