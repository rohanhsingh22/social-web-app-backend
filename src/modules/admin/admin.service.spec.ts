import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MessageStatus, ReportStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { ReportsService } from '@app/modules/reports/reports.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  const createService = () => {
    const tx = {
      user: {
        update: jest.fn(),
      },
      session: {
        updateMany: jest.fn(),
      },
      moderationAction: {
        create: jest.fn(),
      },
      channelMessage: {
        update: jest.fn(),
      },
      directMessage: {
        update: jest.fn(),
      },
      channel: {
        updateMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      bannedWord: {
        create: jest.fn(),
        update: jest.fn(),
      },
      report: {
        update: jest.fn(),
      },
    };
    const prisma = {
      bannedWord: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const reportsService = {
      listForAdmin: jest.fn(),
    } as unknown as ReportsService;

    return {
      service: new AdminService(prisma, reportsService),
      prisma,
      reportsService,
      tx,
    };
  };

  it('prevents moderators from moderating themselves', async () => {
    const { service } = createService();

    await expect(service.banUser('admin-id', 'admin-id', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid report status filters', () => {
    const { service } = createService();

    expect(() =>
      service.listReports('not-a-status' as ReportStatus),
    ).toThrow(BadRequestException);
  });

  it('bans users, revokes sessions, and writes an audit action', async () => {
    const { service, tx } = createService();
    tx.user.update.mockResolvedValue({
      id: 'user-id',
      status: UserStatus.banned,
      role: 'user',
      updatedAt: new Date('2026-09-11T10:00:00.000Z'),
    });

    await expect(
      service.banUser('admin-id', 'user-id', { reason: 'abuse' }),
    ).resolves.toEqual(expect.objectContaining({ status: UserStatus.banned }));
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.moderationAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 'admin-id',
        action: 'ban_user',
        targetUserId: 'user-id',
        reason: 'abuse',
      }),
    });
  });

  it('soft-deletes channel messages with an audit action', async () => {
    const { service, tx } = createService();
    tx.channelMessage.update.mockResolvedValue({
      id: 'message-id',
      senderId: 'user-id',
      status: MessageStatus.deleted,
    });

    await expect(
      service.deleteChannelMessage('admin-id', 'message-id', {}),
    ).resolves.toEqual(expect.objectContaining({ status: MessageStatus.deleted }));
    expect(tx.moderationAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'delete_channel_message',
        targetMessageId: 'message-id',
      }),
    });
  });

  it('hides missing direct messages as not found', async () => {
    const { service, tx } = createService();
    tx.directMessage.update.mockRejectedValue(new Error('missing'));

    await expect(
      service.deleteDirectMessage('admin-id', 'missing', {}),
    ).rejects.toThrow(NotFoundException);
  });
});
