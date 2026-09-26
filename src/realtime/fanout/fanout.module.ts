import { Module } from '@nestjs/common';
import { FanoutService } from './fanout.service';

@Module({
  providers: [FanoutService],
  exports: [FanoutService],
})
export class FanoutModule {}
