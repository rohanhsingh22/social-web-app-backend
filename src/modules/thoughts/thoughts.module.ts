import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { THOUGHT_EVENTS_QUEUE } from '@app/common/queues';
import { AuthModule } from '@app/modules/auth/auth.module';
import { ModerationModule } from '@app/modules/moderation/moderation.module';
import { ThoughtsController } from './thoughts.controller';
import { ThoughtsRankingService } from './thoughts-ranking.service';
import { ThoughtsService } from './thoughts.service';

@Module({
  imports: [
    AuthModule,
    ModerationModule,
    BullModule.registerQueue({ name: THOUGHT_EVENTS_QUEUE }),
  ],
  controllers: [ThoughtsController],
  providers: [ThoughtsService, ThoughtsRankingService],
  exports: [ThoughtsService],
})
export class ThoughtsModule {}
