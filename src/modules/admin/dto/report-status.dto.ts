import { ReportStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ReportStatusDto {
  @IsEnum(ReportStatus)
  status!: ReportStatus;
}
