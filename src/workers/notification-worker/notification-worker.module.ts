import { Module } from '@nestjs/common';
import { NotificationsModule } from '@app/modules/notifications/notifications.module';
import { NotificationProcessor } from './notification.processor';

@Module({
  imports: [NotificationsModule],
  providers: [NotificationProcessor],
})
export class NotificationWorkerModule {}
