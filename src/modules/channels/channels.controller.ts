import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { envelope } from '@app/common/api-response';
import { ChannelsService } from './channels.service';

const CHANNEL_CACHE_CONTROL =
  'public, max-age=10, stale-while-revalidate=30';
const MESSAGE_CACHE_CONTROL =
  'public, max-age=1, stale-while-revalidate=5';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  @Header('Cache-Control', CHANNEL_CACHE_CONTROL)
  async list() {
    return envelope({
      channels: await this.channelsService.listPublicChannels(),
    });
  }

  @Get('default')
  @Header('Cache-Control', CHANNEL_CACHE_CONTROL)
  async defaultChannel() {
    return envelope({
      channel: await this.channelsService.getDefaultChannel(),
    });
  }

  @Get(':slug')
  @Header('Cache-Control', CHANNEL_CACHE_CONTROL)
  async getBySlug(@Param('slug') slug: string) {
    return envelope({
      channel: await this.channelsService.getBySlug(slug),
    });
  }

  @Get(':slug/messages')
  @Header('Cache-Control', MESSAGE_CACHE_CONTROL)
  async messages(
    @Param('slug') slug: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '50',
  ) {
    return envelope(await this.channelsService.getMessages(slug, cursor, limit));
  }
}
