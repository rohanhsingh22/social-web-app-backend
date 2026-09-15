import { Job } from 'bullmq';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { ThoughtEventsProcessor } from './thought-events.processor';

describe('ThoughtEventsProcessor', () => {
  const createProcessor = () => {
    const thoughtEvent = {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    const prisma = { thoughtEvent } as unknown as PrismaService;

    return {
      processor: new ThoughtEventsProcessor(prisma),
      thoughtEvent,
    };
  };

  it('inserts event batches in one query', async () => {
    const { processor, thoughtEvent } = createProcessor();
    const job = {
      id: 'job-1',
      name: 'THOUGHT_EVENT_PROCESS',
      data: {
        events: [
          { actorId: 'user-1', type: 'thought_impression', thoughtId: 't1' },
          { actorId: 'user-1', type: 'thought_impression', thoughtId: 't2' },
        ],
      },
    } as Job;

    await expect(processor.process(job)).resolves.toEqual({ inserted: 2 });
    expect(thoughtEvent.createMany).toHaveBeenCalledWith({
      data: job.data.events,
    });
  });

  it('skips empty batches without touching the database', async () => {
    const { processor, thoughtEvent } = createProcessor();
    const job = {
      id: 'job-1',
      name: 'THOUGHT_EVENT_PROCESS',
      data: { events: [] },
    } as Job;

    await expect(processor.process(job)).resolves.toEqual({ inserted: 0 });
    expect(thoughtEvent.createMany).not.toHaveBeenCalled();
  });
});
