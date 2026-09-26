import { Module } from '@nestjs/common';
import { RealtimeAuthModule } from '@app/realtime/realtime-auth/realtime-auth.module';
import { NotificationsGateway } from './notifications.gateway';

@Module({
  imports: [RealtimeAuthModule],
  providers: [NotificationsGateway],
})
export class NotificationsGatewayModule {}
