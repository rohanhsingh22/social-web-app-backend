import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { envelope } from '@app/common/api-response';

@Controller('admin')
export class AdminController {
  @Get('reports')
  reports() {
    return envelope({ reports: [] });
  }

  @Post('users/:id/mute')
  mute(@Param('id') id: string) {
    return envelope({ id, action: 'mute_user' });
  }

  @Post('users/:id/unmute')
  unmute(@Param('id') id: string) {
    return envelope({ id, action: 'unmute_user' });
  }

  @Post('users/:id/ban')
  ban(@Param('id') id: string) {
    return envelope({ id, action: 'ban_user' });
  }

  @Post('users/:id/unban')
  unban(@Param('id') id: string) {
    return envelope({ id, action: 'unban_user' });
  }

  @Delete('channel-messages/:id')
  deleteChannelMessage(@Param('id') id: string) {
    return envelope({ id, action: 'delete_channel_message' });
  }

  @Delete('direct-messages/:id')
  deleteDirectMessage(@Param('id') id: string) {
    return envelope({ id, action: 'delete_direct_message' });
  }

  @Post('channels')
  createChannel(@Body() body: Record<string, unknown>) {
    return envelope({ channel: null, received: body });
  }

  @Patch('channels/:id')
  updateChannel(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return envelope({ id, channel: null, received: body });
  }
}
