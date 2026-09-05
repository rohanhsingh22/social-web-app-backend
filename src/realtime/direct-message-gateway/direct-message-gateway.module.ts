import { Module } from '@nestjs/common';
import { DirectMessageGateway } from './direct-message.gateway';

@Module({
  providers: [DirectMessageGateway],
})
export class DirectMessageGatewayModule {}
