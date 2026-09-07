import { Module } from '@nestjs/common';
import { RealtimeRateLimitService } from './realtime-rate-limit.service';

@Module({
  providers: [RealtimeRateLimitService],
  exports: [RealtimeRateLimitService],
})
export class RealtimeRateLimitModule {}
