import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MessageStatus, ReportReason } from '@prisma/client';
import { RateLimitService } from '@app/common/rate-limit.service';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const createService = () => {
    const prisma = {
      report: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      channelMessage: {
        findUnique: jest.fn(),
      },
      directMessage: {
        findUnique: jest.fn(),
      },
    } as unknown as PrismaService;
    const rateLimit = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitService;

    return {
      service: new ReportsService(prisma, rateLimit),
      prisma,
      rateLimit,
    };
  };

  it('requires exactly one report target', async () => {
    const { service } = createService();

    await expect(
      service.create('user-a', { reason: ReportReason.spam }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a report for an existing channel message', async () => {
    const { service, prisma, rateLimit } = createService();
    jest.mocked(prisma.channelMessage.findUnique).mockResolvedValue({
      id: 'message-id',
      status: MessageStatus.active,
    } as never);
    jest.mocked(prisma.report.create).mockResolvedValue({
      id: 'report-id',
      targetChannelMessageId: 'message-id',
    } as never);

    await expect(
      service.create('user-a', {
        targetChannelMessageId: 'message-id',
        reason: ReportReason.harassment,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'report-id' }));
    expect(rateLimit.assertAllowed).toHaveBeenCalledWith(
      'ratelimit:reports:create:user-a',
      50,
      86_400,
    );
  });

  it('requires membership before reporting a direct message', async () => {
    const { service, prisma } = createService();
    jest.mocked(prisma.directMessage.findUnique).mockResolvedValue({
      id: 'message-id',
      status: MessageStatus.active,
      conversation: { members: [] },
    } as never);

    await expect(
      service.create('user-a', {
        targetDirectMessageId: 'message-id',
        reason: ReportReason.harassment,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('hides missing target messages as not found', async () => {
    const { service, prisma } = createService();
    jest.mocked(prisma.channelMessage.findUnique).mockResolvedValue(null);

    await expect(
      service.create('user-a', {
        targetChannelMessageId: 'missing',
        reason: ReportReason.spam,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
