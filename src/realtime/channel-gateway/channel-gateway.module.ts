import { Module } from '@nestjs/common';
import { ChannelsModule } from '@app/modules/channels/channels.module';
import { PresenceModule } from '@app/realtime/presence/presence.module';
import { RealtimeAuthModule } from '@app/realtime/realtime-auth/realtime-auth.module';
import { RealtimeRateLimitModule } from '@app/realtime/realtime-rate-limit/realtime-rate-limit.module';
import { ChannelGateway } from './channel.gateway';

@Module({
  imports: [
    ChannelsModule,
    PresenceModule,
    RealtimeAuthModule,
    RealtimeRateLimitModule,
  ],
  providers: [ChannelGateway],
})
export class ChannelGatewayModule {}
