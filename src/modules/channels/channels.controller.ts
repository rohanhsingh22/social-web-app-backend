import { Controller, Get, Param, Query } from '@nestjs/common';
import { envelope } from '@app/common/api-response';
import { ChannelsService } from './channels.service';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  async list() {
    return envelope({
      channels: await this.channelsService.listPublicChannels(),
    });
  }

  @Get('default')
  async defaultChannel() {
    return envelope({
      channel: await this.channelsService.getDefaultChannel(),
    });
  }

  @Get(':slug')
  async getBySlug(@Param('slug') slug: string) {
    return envelope({
      channel: await this.channelsService.getBySlug(slug),
    });
  }

  @Get(':slug/messages')
  async messages(
    @Param('slug') slug: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '50',
  ) {
    return envelope(await this.channelsService.getMessages(slug, cursor, limit));
  }
}
