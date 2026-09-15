import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { ToliService } from './toli.service';

describe('ToliService', () => {
  const createService = () => {
    const toli = {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    };
    const prisma = { toli } as unknown as PrismaService;

    return { service: new ToliService(prisma), toli };
  };

  const row = (overrides = {}) => ({
    id: 'toli-id',
    name: 'Vector',
    description: 'Move with purpose.',
    motto: 'Move with purpose.',
    _count: { profiles: 3 },
    ...overrides,
  });

  it('lists Tolies with avatars and member counts', async () => {
    const { service, toli } = createService();
    toli.findMany.mockResolvedValue([row()]);

    await expect(service.listTolis()).resolves.toEqual([
      {
        id: 'toli-id',
        name: 'Vector',
        description: 'Move with purpose.',
        motto: 'Move with purpose.',
        memberCount: 3,
        avatars: [
          'vector_01',
          'vector_02',
          'vector_03',
          'vector_04',
          'vector_05',
        ],
      },
    ]);
  });

  it('resolves a Toli by id or case-insensitive name', async () => {
    const { service, toli } = createService();
    toli.findUnique.mockResolvedValue(row());
    toli.findFirst.mockResolvedValue(
      row({ id: 'wave-id', name: 'Wave', _count: { profiles: 0 } }),
    );

    await expect(
      service.getToli('123e4567-e89b-12d3-a456-426614174000'),
    ).resolves.toEqual(expect.objectContaining({ name: 'Vector' }));
    await expect(service.getToli('wave')).resolves.toEqual(
      expect.objectContaining({ id: 'wave-id', memberCount: 0 }),
    );
    expect(toli.findFirst).toHaveBeenCalledWith({
      where: { name: { equals: 'wave', mode: 'insensitive' } },
      include: { _count: { select: { profiles: true } } },
    });
  });

  it('throws for unknown Tolies', async () => {
    const { service, toli } = createService();
    toli.findFirst.mockResolvedValue(null);

    await expect(service.getToli('nope')).rejects.toThrow(NotFoundException);
  });
});
