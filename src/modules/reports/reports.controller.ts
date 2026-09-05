import { Body, Controller, Post } from '@nestjs/common';
import { envelope } from '@app/common/api-response';

@Controller('reports')
export class ReportsController {
  @Post()
  create(@Body() body: Record<string, unknown>) {
    return envelope({ report: null, received: body });
  }
}
