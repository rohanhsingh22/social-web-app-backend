import { Module } from "@nestjs/common";
import { DirectMessagesModule } from "@app/modules/direct-messages/direct-messages.module";
import { RealtimeAuthModule } from "@app/realtime/realtime-auth/realtime-auth.module";
import { RealtimeRateLimitModule } from "@app/realtime/realtime-rate-limit/realtime-rate-limit.module";
import { DirectMessageGateway } from "./direct-message.gateway";

@Module({
  imports: [DirectMessagesModule, RealtimeAuthModule, RealtimeRateLimitModule],
  providers: [DirectMessageGateway],
})
export class DirectMessageGatewayModule {}
