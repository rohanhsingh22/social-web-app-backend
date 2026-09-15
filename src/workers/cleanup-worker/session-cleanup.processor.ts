import { Logger, OnModuleInit } from '@nestjs/common';
import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import {
  REVOKED_SESSION_RETENTION_MS,
  SESSION_CLEANUP_EVERY_MS,
  SESSION_CLEANUP_JOB,
  SESSION_CLEANUP_QUEUE,
} from '@app/common/queues';
import { PrismaService } from '@app/core/prisma/prisma.service';

@Processor(SESSION_CLEANUP_QUEUE)
export class SessionCleanupProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(SessionCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SESSION_CLEANUP_QUEUE)
    private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      SESSION_CLEANUP_JOB,
      { every: SESSION_CLEANUP_EVERY_MS },
      { name: SESSION_CLEANUP_JOB, data: {} },
    );
    this.logger.log(
      `Session cleanup scheduled every ${SESSION_CLEANUP_EVERY_MS}ms`,
    );
  }

  async process(job: Job): Promise<{ expired: number; revoked: number }> {
    if (job.name !== SESSION_CLEANUP_JOB) {
      this.logger.warn(
        `Ignoring unknown job ${job.name} on ${SESSION_CLEANUP_QUEUE}`,
      );
      return { expired: 0, revoked: 0 };
    }

    const now = new Date();
    const [expired, revoked] = await Promise.all([
      this.prisma.session.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
      this.prisma.session.deleteMany({
        where: {
          revokedAt: {
            lt: new Date(now.getTime() - REVOKED_SESSION_RETENTION_MS),
          },
        },
      }),
    ]);

    this.logger.log(
      `Session cleanup removed ${expired.count} expired and ${revoked.count} revoked sessions`,
    );

    return { expired: expired.count, revoked: revoked.count };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(
      `Session cleanup job ${job?.id ?? 'unknown'} failed: ${error.message}`,
    );
  }
}
