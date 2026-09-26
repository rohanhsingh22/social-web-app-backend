import { Logger, OnModuleInit } from '@nestjs/common';
import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  MESSAGE_CLEANUP_EVERY_MS,
  MESSAGE_CLEANUP_JOB,
  MESSAGE_CLEANUP_QUEUE,
} from '@app/common/queues';
import { PrismaService } from '@app/core/prisma/prisma.service';

// Hard-deletes channel + DM messages older than the retention window.
// Disabled unless MESSAGE_RETENTION_DAYS > 0 (default 0 = keep forever).
@Processor(MESSAGE_CLEANUP_QUEUE)
export class MessageCleanupProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(MessageCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(MESSAGE_CLEANUP_QUEUE)
    private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      MESSAGE_CLEANUP_JOB,
      { every: MESSAGE_CLEANUP_EVERY_MS },
      { name: MESSAGE_CLEANUP_JOB, data: {} },
    );
    this.logger.log(
      `Message cleanup scheduled every ${MESSAGE_CLEANUP_EVERY_MS}ms`,
    );
  }

  async process(job: Job): Promise<{ channelMessages: number; directMessages: number }> {
    if (job.name !== MESSAGE_CLEANUP_JOB) {
      this.logger.warn(
        `Ignoring unknown job ${job.name} on ${MESSAGE_CLEANUP_QUEUE}`,
      );
      return { channelMessages: 0, directMessages: 0 };
    }

    const days = this.config.get<number>('retention.messageRetentionDays', 0);

    if (!days || days <= 0) {
      this.logger.debug('Message retention disabled, skipping sweep');
      return { channelMessages: 0, directMessages: 0 };
    }

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [channelMessages, directMessages] = await Promise.all([
      this.prisma.channelMessage.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }),
      this.prisma.directMessage.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }),
    ]);

    this.logger.log(
      `Message cleanup removed ${channelMessages.count} channel and ${directMessages.count} direct messages older than ${days}d`,
    );

    return {
      channelMessages: channelMessages.count,
      directMessages: directMessages.count,
    };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(
      `Message cleanup job ${job?.id ?? 'unknown'} failed: ${error.message}`,
    );
  }
}
