import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { envelope } from '@app/common/api-response';

@Controller('blocks')
export class BlocksController {
  @Get()
  list() {
    return envelope({ blocks: [] });
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return envelope({ block: null, received: body });
  }

  @Delete(':blockedUserId')
  remove(@Param('blockedUserId') blockedUserId: string) {
    return envelope({ blockedUserId, removed: true });
  }
}
