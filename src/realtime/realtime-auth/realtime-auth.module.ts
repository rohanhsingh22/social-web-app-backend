import { Module } from '@nestjs/common';
import { AuthModule } from '@app/modules/auth/auth.module';
import { RealtimeAuthService } from './realtime-auth.service';

@Module({
  imports: [AuthModule],
  providers: [RealtimeAuthService],
  exports: [RealtimeAuthService],
})
export class RealtimeAuthModule {}
