import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
    // Shared Bull config for queues registered by imported feature modules
    // (e.g. notifications via DirectMessagesModule). Without this, those
    // queues silently fall back to localhost:6379.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.getOrThrow<string>('redis.url'),
        },
      }),
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
