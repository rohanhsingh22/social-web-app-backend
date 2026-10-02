import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { request as httpRequest } from 'http';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { RedisService } from '@app/core/redis/redis.service';
import {
  MESSAGE_CLEANUP_QUEUE,
  NOTIFICATIONS_QUEUE,
  SESSION_CLEANUP_QUEUE,
  THOUGHT_EVENTS_QUEUE,
} from '@app/common/queues';

const QUEUE_NAMES = [
  NOTIFICATIONS_QUEUE,
  THOUGHT_EVENTS_QUEUE,
  SESSION_CLEANUP_QUEUE,
  MESSAGE_CLEANUP_QUEUE,
] as const;

const MAX_REDACTED_LENGTH = 300;

/** First line only — stacks may contain paths, payloads never leave Redis. */
function redactReason(reason: unknown): string | null {
  if (typeof reason !== 'string' || reason.length === 0) return null;
  const firstLine = reason.split('\n', 1)[0];
  return firstLine.length > MAX_REDACTED_LENGTH
    ? `${firstLine.slice(0, MAX_REDACTED_LENGTH)}…`
    : firstLine;
}

export type ServiceStatus = 'up' | 'down' | 'unknown';

/**
 * Phase 5 protected ops telemetry. Every check is fail-soft: a Redis outage
 * yields `down`/`unknown` entries, never a 500, so the dashboard renders
 * partial-outage states. Queue handles are opened per call and closed in
 * `finally` — no persistent extra Redis clients (the deployment already runs
 * near its Cloud client cap). Failed-job payloads (`data`) are never
 * returned; only redacted failure reasons, names and timestamps.
 */
@Injectable()
export class AdminOpsService {
  private readonly logger = new Logger(AdminOpsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getHealth() {
    const [database, redisOk, queues] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.queueStatuses().catch(() => null),
    ]);
    const realtime = await this.checkRealtime();
    const workersObserved = queues?.reduce((total, q) => total + q.workers, 0) ?? 0;
    const worker: ServiceStatus =
      queues === null ? 'unknown' : workersObserved > 0 ? 'up' : 'down';
    const failedJobs =
      queues?.reduce((total, q) => total + q.counts.failed, 0) ?? null;
    const status =
      database === 'up' && redisOk === 'up' && worker !== 'down' ? 'ok' : 'degraded';
    return {
      status,
      timestamp: new Date().toISOString(),
      services: { api: 'up' as ServiceStatus, database, redis: redisOk, realtime, worker },
      queuesFailedJobs: failedJobs,
    };
  }

  async getQueues() {
    const queues = await this.queueStatuses();
    return { queues, timestamp: new Date().toISOString() };
  }

  async getFailedJobs(cursor?: string, limitValue?: string) {
    const limit = this.parseLimit(limitValue);
    const cursorDate = cursor ? new Date(cursor) : null;
    if (cursor && Number.isNaN(cursorDate?.getTime())) {
      throw new BadRequestException('INVALID_CURSOR');
    }
    const collected: Array<{
      id: string;
      queue: string;
      name: string;
      failedReason: string | null;
      failedAt: string;
      attemptsMade: number;
    }> = [];
    for (const name of QUEUE_NAMES) {
      const page = await this.withQueue(name, (queue) => queue.getFailed(0, limit));
      for (const job of page) {
        const failedAt = job.finishedOn ? new Date(job.finishedOn) : null;
        if (!failedAt) continue;
        if (cursorDate && failedAt >= cursorDate) continue;
        collected.push({
          id: job.id ?? 'unknown',
          queue: name,
          name: job.name,
          failedReason: redactReason(job.failedReason),
          failedAt: failedAt.toISOString(),
          attemptsMade: job.attemptsMade,
        });
      }
    }
    collected.sort((a, b) => b.failedAt.localeCompare(a.failedAt));
    const page = collected.slice(0, limit);
    return {
      items: page,
      nextCursor: collected.length > limit ? page[page.length - 1].failedAt : null,
      hasMore: collected.length > limit,
    };
  }

  private async checkDatabase(): Promise<ServiceStatus> {
    try {
      return (await this.prisma.health()) ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<ServiceStatus> {
    try {
      return (await this.redis.health()) ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  /** Any HTTP response (even 404) proves the Socket.IO port is alive. */
  private checkRealtime(): Promise<ServiceStatus> {
    const port = this.config.get<number>('app.realtimePort') ?? 3002;
    return new Promise((resolve) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 2500 },
        (res) => {
          res.resume();
          resolve('up');
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve('down');
      });
      req.on('error', (error: NodeJS.ErrnoException) => {
        resolve(error?.code === 'ECONNREFUSED' ? 'down' : 'unknown');
      });
      req.end();
    });
  }

  private async queueStatuses() {
    return Promise.all(
      QUEUE_NAMES.map(async (name) =>
        this.withQueue(name, async (queue) => {
          const [counts, workers, waiting] = await Promise.all([
            queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
            queue.getWorkers(),
            queue.getWaiting(0, 0),
          ]);
          const oldest = waiting[0]?.timestamp;
          return {
            name,
            counts: {
              waiting: counts.waiting,
              active: counts.active,
              delayed: counts.delayed,
              completed: counts.completed,
              failed: counts.failed,
            },
            workers: workers.length,
            oldestWaitingAgeMs: oldest ? Date.now() - oldest : null,
          };
        }),
      ),
    );
  }

  private async withQueue<T>(name: string, fn: (queue: Queue) => Promise<T>): Promise<T> {
    const queue = new Queue(name, {
      connection: { url: this.config.getOrThrow<string>('redis.url') },
    });
    try {
      return await fn(queue);
    } catch (error) {
      this.logger.debug(
        `Ops queue inspect failed for ${name}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw error;
    } finally {
      await queue.close().catch(() => undefined);
    }
  }

  private parseLimit(limitValue?: string) {
    const limit = Number(limitValue ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('INVALID_LIMIT');
    }
    return limit;
  }
}
