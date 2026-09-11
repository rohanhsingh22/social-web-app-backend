import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModerationModule } from '@app/modules/moderation/moderation.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';

@Module({
  imports: [ConfigModule, ModerationModule],
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
