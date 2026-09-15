import { Job, Queue } from 'bullmq';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { SessionCleanupProcessor } from './session-cleanup.processor';

describe('SessionCleanupProcessor', () => {
  const createProcessor = () => {
    const session = {
      deleteMany: jest
        .fn()
        .mockResolvedValueOnce({ count: 3 })
        .mockResolvedValueOnce({ count: 1 }),
    };
    const prisma = { session } as unknown as PrismaService;
    const queue = {
      upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    } as unknown as Queue;

    return {
      processor: new SessionCleanupProcessor(prisma, queue),
      session,
      queue,
    };
  };

  it('schedules itself every six hours on startup', async () => {
    const { processor, queue } = createProcessor();

    await processor.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'SESSION_CLEANUP',
      { every: 6 * 60 * 60 * 1000 },
      expect.objectContaining({ name: 'SESSION_CLEANUP' }),
    );
  });

  it('removes expired and long-revoked sessions', async () => {
    const { processor, session } = createProcessor();
    const job = { id: 'job-1', name: 'SESSION_CLEANUP', data: {} } as Job;

    await expect(processor.process(job)).resolves.toEqual({
      expired: 3,
      revoked: 1,
    });
    expect(session.deleteMany).toHaveBeenCalledTimes(2);
    expect(session.deleteMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          expiresAt: expect.objectContaining({ lte: expect.any(Date) }),
        }),
      }),
    );
  });

  it('ignores unknown job names', async () => {
    const { processor, session } = createProcessor();
    const job = { id: 'job-1', name: 'SOMETHING_ELSE', data: {} } as Job;

    await expect(processor.process(job)).resolves.toEqual({
      expired: 0,
      revoked: 0,
    });
    expect(session.deleteMany).not.toHaveBeenCalled();
  });
});
