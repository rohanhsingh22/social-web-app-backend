import { Module } from "@nestjs/common";
import { RateLimitService } from "@app/common/rate-limit.service";
import { ConnectionsController } from "./connections.controller";
import { ConnectionsService } from "./connections.service";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ThoughtsModule } from "../thoughts/thoughts.module";

@Module({
  imports: [AuthModule, NotificationsModule, ThoughtsModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, RateLimitService],
})
export class ConnectionsModule {}
