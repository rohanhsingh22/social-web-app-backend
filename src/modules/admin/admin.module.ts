import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '@app/modules/notifications/notifications.module';
import { ReportsModule } from '@app/modules/reports/reports.module';
import { ChannelsModule } from '@app/modules/channels/channels.module';
import { IntegrationModule } from '@app/modules/integration/integration.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AdminReadsService } from './admin-reads.service';
import { AdminCasesService } from './admin-cases.service';
import { AdminOpsService } from './admin-ops.service';
import { AuthModule } from '../auth/auth.module';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminAuthGuard } from './auth/admin-auth.guard';
import { AdminPermissionsGuard } from './auth/admin-permissions.guard';
import { AdminAuditService } from './auth/admin-audit.service';
import { TotpService } from './auth/totp.service';

@Module({
  imports: [
    NotificationsModule,
    ReportsModule,
    AuthModule,
    ChannelsModule,
    IntegrationModule,
    JwtModule.register({}),
  ],
  controllers: [AdminController, AdminAuthController],
  providers: [
    AdminService,
    AdminReadsService,
    AdminCasesService,
    AdminOpsService,
    AdminGuard,
    AdminAuthService,
    AdminAuthGuard,
    AdminPermissionsGuard,
    AdminAuditService,
    TotpService,
  ],
  exports: [AdminAuthService, AdminAuditService],
})
export class AdminModule {}
