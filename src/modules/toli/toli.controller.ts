import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { envelope } from '@app/common/api-response';
import { Public } from '@app/common/public.decorator';
import { AuthGuard } from '@app/modules/auth/auth.guard';
import { ToliService } from './toli.service';

@Controller('tolis')
@UseGuards(AuthGuard)
export class ToliController {
  constructor(private readonly toliService: ToliService) {}

  @Public()
  @Get()
  async list() {
    return envelope({
      tolis: await this.toliService.listTolis(),
    });
  }

  @Public()
  @Get(':idOrName')
  async getOne(@Param('idOrName') idOrName: string) {
    return envelope({
      toli: await this.toliService.getToli(idOrName),
    });
  }
}
