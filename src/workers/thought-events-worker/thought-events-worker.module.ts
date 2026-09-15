import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { THOUGHT_EVENTS_QUEUE } from '@app/common/queues';
import { ThoughtEventsProcessor } from './thought-events.processor';

@Module({
  imports: [BullModule.registerQueue({ name: THOUGHT_EVENTS_QUEUE })],
  providers: [ThoughtEventsProcessor],
})
export class ThoughtEventsWorkerModule {}
