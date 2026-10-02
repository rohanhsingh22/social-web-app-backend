import { PrismaService } from '@app/core/prisma/prisma.service';
import { AdminReadsService } from './admin-reads.service';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const rows = (entries: Array<[string, number]>) =>
  entries.map(([iso, count]) => ({ bucket: day(iso), count: BigInt(count) }));

function readsWith(queryRaw: jest.Mock) {
  return new AdminReadsService({ $queryRaw: queryRaw } as unknown as PrismaService);
}

describe('Phase 5 analytics aggregates', () => {
  it('merges daily series, zero-fills gaps, and totals', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce(rows([['2026-09-25', 4]])) // registrations
      .mockResolvedValueOnce(rows([['2026-09-25', 10], ['2026-09-26', 6]])) // messages
      .mockResolvedValueOnce(rows([])) // thoughts
      .mockResolvedValueOnce(rows([['2026-09-26', 2]])) // reportsCreated
      .mockResolvedValueOnce(rows([])) // reportsResolved
      .mockResolvedValueOnce(rows([['2026-09-25', 7]])); // active
    const service = readsWith(queryRaw);
    const result = await service.getAnalyticsOverview({
      from: '2026-09-25T00:00:00.000Z',
      to: '2026-09-26T23:59:59.999Z',
    });
    expect(result.granularity).toBe('day');
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[0]).toMatchObject({
      bucket: '2026-09-25',
      registrations: 4,
      messages: 10,
      thoughts: 0,
      activeUsers: 7,
    });
    expect(result.buckets[1]).toMatchObject({ bucket: '2026-09-26', messages: 6, reportsCreated: 2 });
    expect(result.totals).toMatchObject({
      registrations: 4,
      messages: 16,
      reportsCreated: 2,
      reportsResolved: 0,
    });
  });

  it('rejects over-wide ranges and honors week granularity', async () => {
    const service = readsWith(jest.fn());
    await expect(
      service.getAnalyticsOverview({ from: '2020-01-01', to: '2026-09-27' }),
    ).rejects.toThrow('RANGE_TOO_WIDE');
    await expect(
      service.getAnalyticsActivity({ from: 'not-a-date', to: '2026-09-27' }),
    ).rejects.toThrow();
  });

  it('falls back to day buckets for unknown granularity', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const service = readsWith(queryRaw);
    const result = await service.getAnalyticsActivity({
      from: '2026-09-20T00:00:00.000Z',
      to: '2026-09-26T00:00:00.000Z',
      granularity: 'fortnight',
    });
    expect(result.granularity).toBe('day');
    expect(queryRaw).toHaveBeenCalledTimes(6);
  });
});
