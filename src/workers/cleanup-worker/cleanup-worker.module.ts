import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SESSION_CLEANUP_QUEUE } from '@app/common/queues';
import { SessionCleanupProcessor } from './session-cleanup.processor';

@Module({
  imports: [BullModule.registerQueue({ name: SESSION_CLEANUP_QUEUE })],
  providers: [SessionCleanupProcessor],
})
export class CleanupWorkerModule {}
