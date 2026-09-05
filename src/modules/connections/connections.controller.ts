import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { envelope } from '@app/common/api-response';

@Controller('connections')
export class ConnectionsController {
  @Get()
  list() {
    return envelope({ connections: [] });
  }

  @Get('requests/received')
  received() {
    return envelope({ requests: [] });
  }

  @Get('requests/sent')
  sent() {
    return envelope({ requests: [] });
  }

  @Post('requests')
  create(@Body() body: Record<string, unknown>) {
    return envelope({ request: null, received: body });
  }

  @Post('requests/:id/accept')
  accept(@Param('id') id: string) {
    return envelope({ id, status: 'accepted' });
  }

  @Post('requests/:id/reject')
  reject(@Param('id') id: string) {
    return envelope({ id, status: 'rejected' });
  }

  @Post('requests/:id/cancel')
  cancel(@Param('id') id: string) {
    return envelope({ id, status: 'cancelled' });
  }

  @Delete(':connectionId')
  remove(@Param('connectionId') connectionId: string) {
    return envelope({ connectionId, removed: true });
  }
}
