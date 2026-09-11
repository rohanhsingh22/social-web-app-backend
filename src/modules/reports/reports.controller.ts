import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { envelope } from '@app/common/api-response';
import { AuthGuard } from '@app/modules/auth/auth.guard';
import { CurrentUser } from '@app/modules/auth/current-user.decorator';
import { AuthenticatedUser } from '@app/modules/auth/auth.types';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateReportDto,
  ) {
    return envelope({ report: await this.reportsService.create(user.id, body) });
  }
}
