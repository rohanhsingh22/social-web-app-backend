import { AdminOpsService } from './admin-ops.service';

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
}));

import { Queue } from 'bullmq';

const MockQueue = Queue as unknown as jest.Mock;

function opsWith(opts: {
  dbUp?: boolean;
  redisUp?: boolean;
  queues?: Array<{
    counts?: Record<string, number>;
    workers?: number;
    waiting?: Array<{ timestamp?: number }>;
    failed?: Array<Record<string, unknown>>;
  }>;
} = {}) {
  const queueMocks = (opts.queues ?? []).map((q) => ({
    getJobCounts: jest.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      ...(q.counts ?? {}),
    }),
    getWorkers: jest.fn().mockResolvedValue(new Array(q.workers ?? 0).fill({})),
    getWaiting: jest.fn().mockResolvedValue(q.waiting ?? []),
    getFailed: jest.fn().mockResolvedValue(q.failed ?? []),
    close: jest.fn().mockResolvedValue(undefined),
  }));
  let call = 0;
  MockQueue.mockImplementation(() => queueMocks[call++ % Math.max(queueMocks.length, 1)] ?? {
    getJobCounts: jest.fn().mockResolvedValue({}),
    getWorkers: jest.fn().mockResolvedValue([]),
    getWaiting: jest.fn().mockResolvedValue([]),
    getFailed: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
  });
  const prisma = { health: jest.fn().mockResolvedValue(opts.dbUp ?? true) } as never;
  const redis = {
    health: jest.fn().mockImplementation(async () => {
      if (opts.redisUp ?? true) return true;
      throw new Error('down');
    }),
  } as never;
  const config = { get: jest.fn().mockReturnValue(undefined), getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379') } as never;
  return new AdminOpsService(config, prisma, redis);
}

describe('Phase 5 ops telemetry', () => {
  beforeEach(() => {
    MockQueue.mockClear();
  });

  it('reports degraded (never throws) when Redis is down', async () => {
    const service = opsWith({ redisUp: false });
    const health = await service.getHealth();
    expect(health.status).toBe('degraded');
    expect(health.services.redis).toBe('down');
    expect(health.services.api).toBe('up');
  });

  it('marks worker up when queue workers are observed', async () => {
    const service = opsWith({ queues: [{ workers: 2 }, {}, {}, {}] });
    const health = await service.getHealth();
    expect(health.services.worker).toBe('up');
  });

  it('redacts failed-job payloads to first-line reasons only', async () => {
    const service = opsWith({
      queues: [
        {
          failed: [
            {
              id: 'j-1',
              name: 'NOTIFICATION_CREATE',
              failedReason: 'Error: timeout\n    at socket (/secret/path.js:10)\nuser-token-abc',
              finishedOn: new Date('2026-09-26T10:00:00.000Z').getTime(),
              attemptsMade: 3,
              data: { userId: 'u-1', token: 'should-never-appear' },
            },
          ],
        },
        {},
        {},
        {},
      ],
    });
    const result = await service.getFailedJobs(undefined, '20');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].failedReason).toBe('Error: timeout');
    expect(result.items[0]).not.toHaveProperty('data');
    expect(JSON.stringify(result)).not.toContain('should-never-appear');
  });

  it('truncates long failure reasons and validates cursors/limits', async () => {
    const service = opsWith({
      queues: [
        { failed: [{ id: 'j-2', name: 'X', failedReason: 'e'.repeat(500), finishedOn: Date.now(), attemptsMade: 1 }] },
        {},
        {},
        {},
      ],
    });
    const result = await service.getFailedJobs(undefined, '20');
    expect(result.items[0].failedReason?.length).toBeLessThanOrEqual(301);
    await expect(service.getFailedJobs('not-a-date', '20')).rejects.toThrow('INVALID_CURSOR');
    await expect(service.getFailedJobs(undefined, '999')).rejects.toThrow('INVALID_LIMIT');
  });
});
