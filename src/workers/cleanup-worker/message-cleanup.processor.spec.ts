import { Job, Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { MessageCleanupProcessor } from './message-cleanup.processor';

describe('MessageCleanupProcessor', () => {
  const createProcessor = (retentionDays: number) => {
    const channelMessage = {
      deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
    };
    const directMessage = {
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    const prisma = {
      channelMessage,
      directMessage,
    } as unknown as PrismaService;
    const config = {
      get: jest.fn().mockReturnValue(retentionDays),
    } as unknown as ConfigService;
    const queue = {
      upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    } as unknown as Queue;

    return {
      processor: new MessageCleanupProcessor(prisma, config, queue),
      channelMessage,
      directMessage,
      config,
      queue,
    };
  };

  it('schedules itself daily on startup', async () => {
    const { processor, queue } = createProcessor(0);

    await processor.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'MESSAGE_CLEANUP',
      { every: 24 * 60 * 60 * 1000 },
      expect.objectContaining({ name: 'MESSAGE_CLEANUP' }),
    );
  });

  it('skips the sweep when retention is disabled', async () => {
    const { processor, channelMessage, directMessage } = createProcessor(0);
    const job = { id: 'job-1', name: 'MESSAGE_CLEANUP', data: {} } as Job;

    await expect(processor.process(job)).resolves.toEqual({
      channelMessages: 0,
      directMessages: 0,
    });
    expect(channelMessage.deleteMany).not.toHaveBeenCalled();
    expect(directMessage.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes messages older than the retention window', async () => {
    const { processor, channelMessage, directMessage } = createProcessor(90);
    const job = { id: 'job-1', name: 'MESSAGE_CLEANUP', data: {} } as Job;

    await expect(processor.process(job)).resolves.toEqual({
      channelMessages: 5,
      directMessages: 2,
    });
    expect(channelMessage.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
    expect(directMessage.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
  });

  it('ignores unknown job names', async () => {
    const { processor, channelMessage } = createProcessor(90);
    const job = { id: 'job-1', name: 'SOMETHING_ELSE', data: {} } as Job;

    await expect(processor.process(job)).resolves.toEqual({
      channelMessages: 0,
      directMessages: 0,
    });
    expect(channelMessage.deleteMany).not.toHaveBeenCalled();
  });
});
