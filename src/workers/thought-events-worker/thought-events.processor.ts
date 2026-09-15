import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  THOUGHT_EVENTS_QUEUE,
  THOUGHT_EVENT_PROCESS_JOB,
} from '@app/common/queues';
import { PrismaService } from '@app/core/prisma/prisma.service';
import type { ThoughtEventBatchItem } from '@app/modules/thoughts/thoughts.service';

export type ThoughtEventProcessJobData = {
  events: ThoughtEventBatchItem[];
};

@Processor(THOUGHT_EVENTS_QUEUE)
export class ThoughtEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(ThoughtEventsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(
    job: Job<ThoughtEventProcessJobData>,
  ): Promise<{ inserted: number }> {
    if (job.name !== THOUGHT_EVENT_PROCESS_JOB) {
      this.logger.warn(
        `Ignoring unknown job ${job.name} on ${THOUGHT_EVENTS_QUEUE}`,
      );
      return { inserted: 0 };
    }

    if (job.data.events.length === 0) {
      return { inserted: 0 };
    }

    const result = await this.prisma.thoughtEvent.createMany({
      data: job.data.events,
    });

    return { inserted: result.count };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ThoughtEventProcessJobData> | undefined, error: Error) {
    this.logger.error(
      `Thought event job ${job?.id ?? 'unknown'} failed permanently: ${
        error.message
      }. Events dropped: ${job?.data.events.length ?? 0}`,
    );
  }
}
