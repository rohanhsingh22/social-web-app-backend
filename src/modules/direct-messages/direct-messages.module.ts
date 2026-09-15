import { Module } from "@nestjs/common";
import { ModerationModule } from "@app/modules/moderation/moderation.module";
import { NotificationsModule } from "@app/modules/notifications/notifications.module";
import { DirectMessagesController } from "./direct-messages.controller";
import { DirectMessagesService } from "./direct-messages.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [ModerationModule, NotificationsModule, AuthModule],
  controllers: [DirectMessagesController],
  providers: [DirectMessagesService],
  exports: [DirectMessagesService],
})
export class DirectMessagesModule {}
