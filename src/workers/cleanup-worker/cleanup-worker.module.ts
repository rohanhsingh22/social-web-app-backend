import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  MESSAGE_CLEANUP_QUEUE,
  SESSION_CLEANUP_QUEUE,
} from '@app/common/queues';
import { SessionCleanupProcessor } from './session-cleanup.processor';
import { MessageCleanupProcessor } from './message-cleanup.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: SESSION_CLEANUP_QUEUE }),
    BullModule.registerQueue({ name: MESSAGE_CLEANUP_QUEUE }),
  ],
  providers: [SessionCleanupProcessor, MessageCleanupProcessor],
})
export class CleanupWorkerModule {}
