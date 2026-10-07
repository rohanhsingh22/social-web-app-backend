import { Module } from '@nestjs/common';
import { RealtimeAuthModule } from '@app/realtime/realtime-auth/realtime-auth.module';
import { PresenceModule } from '@app/realtime/presence/presence.module';
import { HomeGateway } from './home.gateway';

@Module({
  imports: [RealtimeAuthModule, PresenceModule],
  providers: [HomeGateway],
})
export class HomeGatewayModule {}
