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
    const { service } = createService();

    await expect(service.create('user-a', 'user-a')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('hides missing blocked users as not found', async () => {
    const { service, prisma } = createService();
    jest.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(service.create('user-a', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('creates a block and marks the relationship blocked', async () => {
    const { service, prisma, tx } = createService();
    jest.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-b',
      status: UserStatus.active,
    } as never);
    tx.block.upsert.mockResolvedValue({
      id: 'block-id',
      blockerId: 'user-a',
      blockedUserId: 'user-b',
      createdAt: now,
      blockedUser: { id: 'user-b', profile: null },
    });

    await expect(service.create('user-a', 'user-b')).resolves.toEqual(
      expect.objectContaining({
        id: 'block-id',
        blockedUserId: 'user-b',
      }),
    );
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
