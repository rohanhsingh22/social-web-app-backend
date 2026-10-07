import { HomeMemberRole, Prisma } from '@prisma/client';
import { RateLimitService } from '@app/common/rate-limit.service';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { FanoutService } from '@app/realtime/fanout/fanout.service';
import { HomeMembershipService } from './home-membership.service';
import { HomePolicyService } from './home-policy.service';
import { HomeService } from './home.service';
import { HomeVoiceService } from './voice/home-voice.service';

describe('HomeMembershipService', () => {
  const createService = () => {
    const tx = {
      home: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      homeMembership: {
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
    };
    const prisma = {
      homeMembership: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const homes = {
      destroyHome: jest.fn(),
    } as unknown as HomeService;
    const fanout = {
      publishUserEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as FanoutService;
    const voice = {
      removeVoiceParticipant: jest.fn().mockResolvedValue(undefined),
    } as unknown as HomeVoiceService;
    const rateLimit = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitService;

    const service = new HomeMembershipService(
      prisma,
      homes,
      new HomePolicyService(),
      fanout,
      voice,
      rateLimit,
    );
    return { service, prisma, tx, homes, fanout, voice, rateLimit };
  };

  it('joins with a row lock and enforces capacity', async () => {
    const { service, prisma, tx } = createService();
    (tx.home.findUnique as jest.Mock).mockResolvedValue({ id: 'home-a' });
    (tx.homeMembership.findUnique as jest.Mock).mockResolvedValue(null);
    (tx.homeMembership.count as jest.Mock).mockResolvedValue(3);
    (tx.homeMembership.create as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'user-4',
    });
    (prisma.homeMembership.findMany as jest.Mock).mockResolvedValue([
      { userId: 'user-4' },
    ]);

    await expect(service.joinHome('home-a', 'user-4')).resolves.toEqual({
      homeId: 'home-a',
      userId: 'user-4',
    });
    expect(tx.home.update).toHaveBeenCalledWith({
      where: { id: 'home-a' },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('rejects joining a full Home', async () => {
    const { service, tx } = createService();
    (tx.home.findUnique as jest.Mock).mockResolvedValue({ id: 'home-a' });
    (tx.homeMembership.findUnique as jest.Mock).mockResolvedValue(null);
    (tx.homeMembership.count as jest.Mock).mockResolvedValue(4);

    await expect(service.joinHome('home-a', 'user-5')).rejects.toThrow(
      'HOME_FULL',
    );
  });

  it('rejects joining when already in a Home', async () => {
    const { service, tx } = createService();
    (tx.home.findUnique as jest.Mock).mockResolvedValue({ id: 'home-a' });
    (tx.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-b',
      userId: 'user-1',
    });
    (tx.homeMembership.count as jest.Mock).mockResolvedValue(1);

    await expect(service.joinHome('home-a', 'user-1')).rejects.toThrow(
      'ALREADY_IN_HOME',
    );
  });

  it('maps unique-constraint races to ALREADY_IN_HOME', async () => {
    const { service, tx } = createService();
    (tx.home.findUnique as jest.Mock).mockResolvedValue({ id: 'home-a' });
    (tx.homeMembership.findUnique as jest.Mock).mockResolvedValue(null);
    (tx.homeMembership.count as jest.Mock).mockResolvedValue(1);
    (tx.homeMembership.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.joinHome('home-a', 'user-1')).rejects.toThrow(
      'ALREADY_IN_HOME',
    );
  });

  it('lets a participant leave without destroying the Home', async () => {
    const { service, prisma, homes, rateLimit } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'user-2',
      role: HomeMemberRole.PARTICIPANT,
    });
    (prisma.homeMembership.findMany as jest.Mock).mockResolvedValue([
      { userId: 'owner-1' },
      { userId: 'user-2' },
    ]);

    await expect(service.leaveHome('user-2')).resolves.toEqual({
      homeId: 'home-a',
      userId: 'user-2',
    });
    expect(prisma.homeMembership.delete).toHaveBeenCalledWith({
      where: { userId: 'user-2' },
    });
    expect(homes.destroyHome).not.toHaveBeenCalled();
    expect(rateLimit.assertAllowed).toHaveBeenCalledWith(
      'home:actions:rate:user-2',
      60,
      60,
    );
  });

  it('destroys the Home when the owner leaves', async () => {
    const { service, prisma, homes } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'owner-1',
      role: HomeMemberRole.OWNER,
    });
    (homes.destroyHome as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      removedUserIds: ['owner-1', 'user-2'],
    });

    await expect(service.leaveHome('owner-1')).resolves.toEqual({
      homeId: 'home-a',
      removedUserIds: ['owner-1', 'user-2'],
    });
    expect(homes.destroyHome).toHaveBeenCalledWith('home-a', 'owner-1');
    expect(prisma.homeMembership.delete).not.toHaveBeenCalled();
  });

  it('rejects leaving without membership', async () => {
    const { service, prisma } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.leaveHome('stranger')).rejects.toThrow(
      'NOT_HOME_MEMBER',
    );
  });

  it('lets the owner remove a participant', async () => {
    const { service, prisma, voice } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockImplementation(
      ({ where: { userId } }: { where: { userId: string } }) =>
        Promise.resolve(
          userId === 'owner-1'
            ? { homeId: 'home-a', userId, role: HomeMemberRole.OWNER }
            : { homeId: 'home-a', userId, role: HomeMemberRole.PARTICIPANT },
        ),
    );
    (prisma.homeMembership.findMany as jest.Mock).mockResolvedValue([
      { userId: 'owner-1' },
      { userId: 'user-2' },
    ]);

    await expect(
      service.removeMember('home-a', 'owner-1', 'user-2'),
    ).resolves.toEqual({ homeId: 'home-a', userId: 'user-2' });
    expect(prisma.homeMembership.delete).toHaveBeenCalledWith({
      where: { userId: 'user-2' },
    });
    expect(voice.removeVoiceParticipant).toHaveBeenCalledWith(
      'home-a',
      'user-2',
    );
  });

  it('removes membership even when the SFU is unreachable', async () => {
    const { service, prisma, voice } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockImplementation(
      ({ where: { userId } }: { where: { userId: string } }) =>
        Promise.resolve(
          userId === 'owner-1'
            ? { homeId: 'home-a', userId, role: HomeMemberRole.OWNER }
            : { homeId: 'home-a', userId, role: HomeMemberRole.PARTICIPANT },
        ),
    );
    (prisma.homeMembership.findMany as jest.Mock).mockResolvedValue([
      { userId: 'owner-1' },
      { userId: 'user-2' },
    ]);
    (voice.removeVoiceParticipant as jest.Mock).mockRejectedValue(
      new Error('sfu down'),
    );

    await expect(
      service.removeMember('home-a', 'owner-1', 'user-2'),
    ).resolves.toEqual({ homeId: 'home-a', userId: 'user-2' });
    expect(prisma.homeMembership.delete).toHaveBeenCalled();
  });

  it('leaves voice alone on graceful self-leave; membership decides', async () => {
    const { service, prisma, voice } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'user-2',
      role: HomeMemberRole.PARTICIPANT,
    });
    (prisma.homeMembership.findMany as jest.Mock).mockResolvedValue([
      { userId: 'owner-1' },
      { userId: 'user-2' },
    ]);

    await service.leaveHome('user-2');

    // The client disconnects itself; the server must not force anything.
    expect(voice.removeVoiceParticipant).not.toHaveBeenCalled();
  });

  it('rejects removal by participants', async () => {
    const { service, prisma } = createService();
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'user-2',
      role: HomeMemberRole.PARTICIPANT,
    });

    await expect(
      service.removeMember('home-a', 'user-2', 'user-3'),
    ).rejects.toThrow('NOT_HOME_OWNER');
    expect(prisma.homeMembership.delete).not.toHaveBeenCalled();
  });
});
