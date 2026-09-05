import { Module } from '@nestjs/common';
import { DirectMessagesController } from './direct-messages.controller';

@Module({
  controllers: [DirectMessagesController],
})
export class DirectMessagesModule {}
