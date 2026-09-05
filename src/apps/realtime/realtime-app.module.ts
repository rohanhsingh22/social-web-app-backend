import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { appConfig } from '@app/config/app.config';
import { CoreModule } from '@app/core/core.module';
import { RealtimeAuthModule } from '@app/realtime/realtime-auth/realtime-auth.module';
import { ChannelGatewayModule } from '@app/realtime/channel-gateway/channel-gateway.module';
import { DirectMessageGatewayModule } from '@app/realtime/direct-message-gateway/direct-message-gateway.module';
import { PresenceModule } from '@app/realtime/presence/presence.module';
import { RealtimeRateLimitModule } from '@app/realtime/realtime-rate-limit/realtime-rate-limit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      cache: true,
    }),
    CoreModule,
    RealtimeAuthModule,
    ChannelGatewayModule,
    DirectMessageGatewayModule,
    PresenceModule,
    RealtimeRateLimitModule,
  ],
})
export class RealtimeAppModule {}
