import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  NOTIFICATIONS_QUEUE,
  NOTIFICATION_CREATE_JOB,
} from '@app/common/queues';
import {
  NotificationJobData,
  NotificationsService,
} from '@app/modules/notifications/notifications.service';

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<{ id: string } | null> {
    if (job.name !== NOTIFICATION_CREATE_JOB) {
      this.logger.warn(
        `Ignoring unknown job ${job.name} on ${NOTIFICATIONS_QUEUE}`,
      );
      return null;
    }

    const created = await this.notifications.create({
      recipientId: job.data.recipientId,
      type: job.data.type,
      title: job.data.title,
      body: job.data.body,
      metadata: job.data.metadata,
    });

    return { id: created.id };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<NotificationJobData> | undefined, error: Error) {
    // Failed jobs are retained in Redis (removeOnFail cap) for inspection.
    this.logger.error(
      `Notification job ${job?.id ?? 'unknown'} failed permanently: ${
        error.message
      }. Payload: ${JSON.stringify(job?.data ?? null)}`,
    );
  }
}
