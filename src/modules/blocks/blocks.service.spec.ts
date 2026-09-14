import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConnectionStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { BlocksService } from './blocks.service';

describe('BlocksService', () => {
  const now = new Date('2026-09-11T10:00:00.000Z');

  const createService = () => {
    const tx = {
      block: {
        upsert: jest.fn(),
      },
      connection: {
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      block: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      connection: {
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;

    return {
      service: new BlocksService(prisma),
      prisma,
      tx,
    };
  };

  it('rejects self-blocks', async () => {
    const { service, prisma } = createService();
    jest.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-a',
      status: UserStatus.active,
      publicUserId: 'HT-7K4M9Q2X',
    } as never);

    await expect(service.create('user-a', 'HT-7K4M9Q2X')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('hides missing blocked users as not found', async () => {
    const { service, prisma } = createService();
    jest.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(service.create('user-a', 'HT-ZZZZZZZZ')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects invalid public ID formats as not found', async () => {
    const { service, prisma } = createService();

    await expect(service.create('user-a', 'user-b')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('creates a block and marks the relationship blocked', async () => {
    const { service, prisma, tx } = createService();
    jest.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-b',
      status: UserStatus.active,
      publicUserId: 'HT-A8N4P7ZK',
    } as never);
    tx.block.upsert.mockResolvedValue({
      id: 'block-id',
      blockerId: 'user-a',
      blockedUserId: 'user-b',
      createdAt: now,
      blockedUser: { id: 'user-b', profile: null },
    });

    await expect(service.create('user-a', 'ht-a8n4p7zk')).resolves.toEqual(
      expect.objectContaining({
        id: 'block-id',
        blockedUserId: 'user-b',
      }),
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { publicUserId: 'HT-A8N4P7ZK' },
      select: { id: true, status: true, publicUserId: true },
    });
    expect(tx.connection.updateMany).toHaveBeenCalledWith({
      where: {
        userLowId: 'user-a',
        userHighId: 'user-b',
        status: { in: [ConnectionStatus.pending, ConnectionStatus.accepted] },
      },
      data: { status: ConnectionStatus.blocked },
    });
  });
});
