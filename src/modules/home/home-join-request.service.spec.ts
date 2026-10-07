import {
  ConnectionStatus,
  HomeJoinRequestStatus,
  UserStatus,
} from '@prisma/client';
import { RateLimitService } from '@app/common/rate-limit.service';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { FanoutService } from '@app/realtime/fanout/fanout.service';
import { PresenceService } from '@app/realtime/presence/presence.service';
import { HomeJoinRequestService } from './home-join-request.service';
import { HomeMembershipService } from './home-membership.service';
import { HomePolicyService } from './home-policy.service';
import { HomeService } from './home.service';

describe('HomeJoinRequestService', () => {
  const createService = () => {
    const tx = {
      home: {
        findUnique: jest.fn(),
      },
      homeMembership: {
        findUnique: jest.fn(),
      },
      homeJoinRequest: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn(),
      },
      connection: {
        findUnique: jest.fn(),
      },
      home: {
        findUnique: jest.fn(),
      },
      homeMembership: {
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      homeJoinRequest: {
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const homes = {
      getHomeById: jest.fn(),
    } as unknown as HomeService;
    const memberships = {
      joinHomeInTx: jest.fn(),
    } as unknown as HomeMembershipService;
    const presence = {
      isUserOnline: jest.fn(),
    } as unknown as PresenceService;
    const rateLimit = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitService;
    const fanout = {
      publishUserEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as FanoutService;

    const service = new HomeJoinRequestService(
      prisma,
      homes,
      memberships,
      new HomePolicyService(),
      presence,
      rateLimit,
      fanout,
    );
    return { service, prisma, tx, homes, memberships, presence, fanout };
  };

  const activeUser = (id: string) => ({ id, status: UserStatus.active });

  const mockCreateSuccess = (
    prisma: PrismaService,
    presence: PresenceService,
  ) => {
    (prisma.user.findUnique as jest.Mock).mockImplementation(
      ({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(activeUser(id)),
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockImplementation(
      ({ where: { userId } }: { where: { userId: string } }) =>
        Promise.resolve(
          userId === 'requester-1'
            ? null
            : { homeId: 'home-b', userId, role: 'PARTICIPANT' },
        ),
    );
    (prisma.connection.findUnique as jest.Mock).mockResolvedValue({
      status: ConnectionStatus.accepted,
    });
    (presence.isUserOnline as jest.Mock).mockResolvedValue(true);
    (prisma.home.findUnique as jest.Mock).mockResolvedValue({ id: 'home-b' });
    (prisma.homeMembership.count as jest.Mock).mockResolvedValue(2);
    (prisma.homeJoinRequest.count as jest.Mock).mockResolvedValue(0);
    (prisma.homeJoinRequest.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.homeJoinRequest.create as jest.Mock).mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'request-1', ...data }),
    );
  };

  it('creates a join request through the target member', async () => {
    const { service, prisma, presence, fanout } = createService();
    mockCreateSuccess(prisma, presence);

    const request = await service.createJoinRequest(
      'requester-1',
      'target-1',
    );

    expect(request).toEqual(
      expect.objectContaining({
        homeId: 'home-b',
        requesterId: 'requester-1',
        targetMemberId: 'target-1',
        status: HomeJoinRequestStatus.PENDING,
      }),
    );
    expect(fanout.publishUserEvent).toHaveBeenCalledWith(
      ['requester-1', 'target-1'],
      'home:join-request:new',
      {
        joinRequest: expect.objectContaining({
          homeId: 'home-b',
          requesterId: 'requester-1',
          targetMemberId: 'target-1',
        }),
      },
    );
  });

  it('rejects self-requests and housed requesters', async () => {
    const { service, prisma, presence } = createService();

    await expect(
      service.createJoinRequest('user-1', 'user-1'),
    ).rejects.toThrow('CANNOT_REQUEST_SELF');

    (prisma.user.findUnique as jest.Mock).mockImplementation(
      ({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(activeUser(id)),
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'requester-1',
    });
    await expect(
      service.createJoinRequest('requester-1', 'target-1'),
    ).rejects.toThrow('ALREADY_IN_HOME');
    expect(presence.isUserOnline).not.toHaveBeenCalled();
  });

  it('requires the target to be homed', async () => {
    const { service, prisma } = createService();
    (prisma.user.findUnique as jest.Mock).mockImplementation(
      ({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(activeUser(id)),
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockImplementation(
      ({ where: { userId } }: { where: { userId: string } }) =>
        Promise.resolve(
          userId === 'requester-1'
            ? null
            : null,
        ),
    );

    await expect(
      service.createJoinRequest('requester-1', 'target-1'),
    ).rejects.toThrow('TARGET_HAS_NO_HOME');
  });

  it('requires a connection and an online target', async () => {
    const { service, prisma, presence } = createService();
    (prisma.user.findUnique as jest.Mock).mockImplementation(
      ({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(activeUser(id)),
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockImplementation(
      ({ where: { userId } }: { where: { userId: string } }) =>
        Promise.resolve(
          userId === 'requester-1'
            ? null
            : { homeId: 'home-b', userId },
        ),
    );
    (prisma.connection.findUnique as jest.Mock).mockResolvedValue(null);
    (presence.isUserOnline as jest.Mock).mockResolvedValue(true);

    await expect(
      service.createJoinRequest('requester-1', 'target-1'),
    ).rejects.toThrow('NOT_A_CONNECTION');

    (prisma.connection.findUnique as jest.Mock).mockResolvedValue({
      status: ConnectionStatus.accepted,
    });
    (presence.isUserOnline as jest.Mock).mockResolvedValue(false);
    await expect(
      service.createJoinRequest('requester-1', 'target-1'),
    ).rejects.toThrow('TARGET_OFFLINE');
  });

  it('rejects full Homes and duplicate requests', async () => {
    const { service, prisma, presence } = createService();
    mockCreateSuccess(prisma, presence);
    (prisma.homeMembership.count as jest.Mock).mockResolvedValue(4);

    await expect(
      service.createJoinRequest('requester-1', 'target-1'),
    ).rejects.toThrow('HOME_FULL');

    (prisma.homeMembership.count as jest.Mock).mockResolvedValue(2);
    (prisma.homeJoinRequest.findFirst as jest.Mock).mockResolvedValue({
      id: 'request-old',
    });
    await expect(
      service.createJoinRequest('requester-1', 'target-1'),
    ).rejects.toThrow('JOIN_REQUEST_ALREADY_PENDING');
  });

  const pendingRequest = () => ({
    id: 'request-1',
    homeId: 'home-b',
    requesterId: 'requester-1',
    targetMemberId: 'target-1',
    status: HomeJoinRequestStatus.PENDING,
    expiresAt: new Date(Date.now() + 10_000),
  });

  it('accepts via the target member and returns the Home', async () => {
    const { service, prisma, tx, homes, memberships } = createService();
    (prisma.homeJoinRequest.findUnique as jest.Mock).mockResolvedValue(
      pendingRequest(),
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-b',
      userId: 'target-1',
    });
    (tx.homeJoinRequest.findUnique as jest.Mock).mockResolvedValue(
      pendingRequest(),
    );
    (tx.home.findUnique as jest.Mock).mockResolvedValue({ id: 'home-b' });
    (tx.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-b',
      userId: 'target-1',
    });
    (memberships.joinHomeInTx as jest.Mock).mockResolvedValue({
      homeId: 'home-b',
      userId: 'requester-1',
    });
    (homes.getHomeById as jest.Mock).mockResolvedValue({
      id: 'home-b',
      memberships: [{ userId: 'target-1' }, { userId: 'requester-1' }],
    });

    const home = await service.acceptJoinRequest('target-1', 'request-1');

    expect(home).toEqual(expect.objectContaining({ id: 'home-b' }));
    expect(tx.homeJoinRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: {
        status: HomeJoinRequestStatus.ACCEPTED,
        respondedAt: expect.any(Date),
      },
    });
  });

  it('only the target member can respond, and expiry wins', async () => {
    const { service, prisma } = createService();
    (prisma.homeJoinRequest.findUnique as jest.Mock).mockImplementation(
      ({ where: { id } }: { where: { id: string } }) => {
        if (id === 'rejected-1') {
          return Promise.resolve({
            ...pendingRequest(),
            id,
            status: HomeJoinRequestStatus.REJECTED,
          });
        }
        if (id === 'stale-1') {
          return Promise.resolve({
            ...pendingRequest(),
            id,
            expiresAt: new Date(Date.now() - 1000),
          });
        }
        return Promise.resolve(pendingRequest());
      },
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-b',
      userId: 'target-1',
    });

    await expect(
      service.acceptJoinRequest('stranger', 'request-1'),
    ).rejects.toThrow('JOIN_REQUEST_ACTION_NOT_ALLOWED');
    await expect(
      service.acceptJoinRequest('target-1', 'rejected-1'),
    ).rejects.toThrow('JOIN_REQUEST_ALREADY_RESPONDED');
    await expect(
      service.acceptJoinRequest('target-1', 'stale-1'),
    ).rejects.toThrow('JOIN_REQUEST_EXPIRED');
    expect(prisma.homeJoinRequest.update).toHaveBeenCalledWith({
      where: { id: 'stale-1' },
      data: {
        status: HomeJoinRequestStatus.EXPIRED,
        respondedAt: expect.any(Date),
      },
    });
  });

  it('rejects a join request', async () => {
    const { service, prisma, fanout } = createService();
    (prisma.homeJoinRequest.findUnique as jest.Mock).mockResolvedValue(
      pendingRequest(),
    );
    (prisma.homeJoinRequest.update as jest.Mock).mockResolvedValue({
      ...pendingRequest(),
      status: HomeJoinRequestStatus.REJECTED,
    });

    const rejected = await service.rejectJoinRequest('target-1', 'request-1');

    expect(rejected.status).toBe(HomeJoinRequestStatus.REJECTED);
    expect(fanout.publishUserEvent).toHaveBeenCalledWith(
      ['requester-1', 'target-1'],
      'home:changed',
    );
  });

  it('sweeps stale join requests in bulk', async () => {
    const { service, prisma } = createService();
    (prisma.homeJoinRequest.updateMany as jest.Mock).mockResolvedValue({
      count: 2,
    });

    await expect(service.expireStaleJoinRequests()).resolves.toBe(2);
  });
});
