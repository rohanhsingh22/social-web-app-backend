import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { ModerationService } from './moderation.service';

describe('ModerationService', () => {
  const createService = () => {
    const prisma = {
      bannedWord: {
        findMany: jest.fn(),
      },
    } as unknown as PrismaService;

    return {
      service: new ModerationService(prisma),
      prisma,
    };
  };

  it('allows ordinary messages', async () => {
    const { service, prisma } = createService();
    jest.mocked(prisma.bannedWord.findMany).mockResolvedValue([]);

    await expect(service.assertMessageAllowed('hello friends')).resolves.toBeUndefined();
  });

  it('rejects active banned words', async () => {
    const { service, prisma } = createService();
    jest
      .mocked(prisma.bannedWord.findMany)
      .mockResolvedValue([{ word: 'blocked' }] as never);

    await expect(service.assertMessageAllowed('this is blocked')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects obvious repeated-token spam', async () => {
    const { service } = createService();

    await expect(
      service.assertMessageAllowed('spam spam spam spam spam spam spam spam'),
    ).rejects.toThrow(BadRequestException);
  });
});
