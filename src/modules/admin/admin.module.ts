import { Module } from '@nestjs/common';
import { NotificationsModule } from '@app/modules/notifications/notifications.module';
import { ReportsModule } from '@app/modules/reports/reports.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [NotificationsModule, ReportsModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
