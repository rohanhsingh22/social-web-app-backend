import { Module } from '@nestjs/common';
import { BlocksController } from './blocks.controller';
import { BlocksService } from './blocks.service';
import { AuthModule } from '../auth/auth.module';
import { FanoutModule } from '@app/realtime/fanout/fanout.module';

@Module({
  imports: [AuthModule, FanoutModule],
  controllers: [BlocksController],
  providers: [BlocksService],
})
export class BlocksModule {}
