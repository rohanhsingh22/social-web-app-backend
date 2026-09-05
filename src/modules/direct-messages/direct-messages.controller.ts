import { Controller, Get, Param, Query } from '@nestjs/common';
import { envelope } from '@app/common/api-response';

@Controller('dm')
export class DirectMessagesController {
  @Get('conversations')
  conversations() {
    return envelope({ conversations: [] });
  }

  @Get('conversations/:id/messages')
  messages(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '50',
  ) {
    return envelope({
      conversationId: id,
      cursor: cursor ?? null,
      limit: Number(limit),
      messages: [],
    });
  }
}
