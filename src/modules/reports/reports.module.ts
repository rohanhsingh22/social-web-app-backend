import { Module } from '@nestjs/common';
import { RateLimitService } from '@app/common/rate-limit.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule
  ],
  controllers: [ReportsController],
  providers: [ReportsService, RateLimitService],
  exports: [ReportsService],
})
export class ReportsModule {}
