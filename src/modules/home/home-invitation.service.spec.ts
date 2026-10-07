import {
  ConnectionStatus,
  HomeInvitationStatus,
  UserStatus,
} from '@prisma/client';
import { RateLimitService } from '@app/common/rate-limit.service';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { FanoutService } from '@app/realtime/fanout/fanout.service';
import { PresenceService } from '@app/realtime/presence/presence.service';
import { HomeInvitationService } from './home-invitation.service';
import { HomeMembershipService } from './home-membership.service';
import { HomePolicyService } from './home-policy.service';
import { HomeService } from './home.service';

describe('HomeInvitationService', () => {
  const createService = () => {
    const tx = {
      home: {
        findUnique: jest.fn(),
      },
      homeMembership: {
        findUnique: jest.fn(),
      },
      homeInvitation: {
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
      },
      homeInvitation: {
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
      ensureHomeForUser: jest.fn().mockResolvedValue({ id: 'home-a' }),
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

    const service = new HomeInvitationService(
      prisma,
      homes,
      memberships,
      new HomePolicyService(),
      presence,
      rateLimit,
      fanout,
    );
    return { service, prisma, tx, homes, memberships, presence, fanout, rateLimit };
  };

  const activeUser = (id: string) => ({ id, status: UserStatus.active });

  const mockCreateSuccess = (
    prisma: PrismaService,
    presence: PresenceService,
    homes: HomeService,
  ) => {
    (prisma.user.findUnique as jest.Mock).mockImplementation(
      ({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(activeUser(id)),
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockImplementation(
      ({ where: { userId } }: { where: { userId: string } }) =>
        Promise.resolve(
          userId === 'invitee-1'
            ? null
            : { homeId: 'home-a', userId, role: 'OWNER' },
        ),
    );
    (prisma.connection.findUnique as jest.Mock).mockResolvedValue({
      status: ConnectionStatus.accepted,
    });
    (presence.isUserOnline as jest.Mock).mockResolvedValue(true);
    (homes.ensureHomeForUser as jest.Mock).mockResolvedValue({ id: 'home-a' });
    (prisma.home.findUnique as jest.Mock).mockResolvedValue({ id: 'home-a' });
    (prisma.homeInvitation.count as jest.Mock).mockResolvedValue(0);
    (prisma.homeInvitation.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.homeInvitation.create as jest.Mock).mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'invite-1', ...data }),
    );
  };

  it('creates an invitation when all checks pass', async () => {
    const { service, prisma, presence, homes, fanout } = createService();
    mockCreateSuccess(prisma, presence, homes);

    const invitation = await service.createInvitation('user-1', 'invitee-1');

    expect(invitation).toEqual(
      expect.objectContaining({
        homeId: 'home-a',
        inviterId: 'user-1',
        inviteeId: 'invitee-1',
        status: HomeInvitationStatus.PENDING,
      }),
    );
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(fanout.publishUserEvent).toHaveBeenCalledWith(
      ['user-1', 'invitee-1'],
      'home:invitation:new',
      {
        invitation: expect.objectContaining({
          homeId: 'home-a',
          inviterId: 'user-1',
          inviteeId: 'invitee-1',
        }),
      },
    );
  });

  it('rejects self-invites', async () => {
    const { service } = createService();

    await expect(service.createInvitation('user-1', 'user-1')).rejects.toThrow(
      'CANNOT_INVITE_SELF',
    );
  });

  it('bootstraps a Home for first-time inviters', async () => {
    const { service, prisma, presence, homes, fanout } = createService();
    mockCreateSuccess(prisma, presence, homes);
    // Inviter homeless: ensureHomeForUser creates the OWNER home.
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue(null);

    const invitation = await service.createInvitation('user-1', 'invitee-1');

    expect(homes.ensureHomeForUser).toHaveBeenCalledWith('user-1');
    expect(invitation).toEqual(
      expect.objectContaining({ homeId: 'home-a', inviterId: 'user-1' }),
    );
    expect(fanout.publishUserEvent).toHaveBeenCalledWith(
      ['user-1', 'invitee-1'],
      'home:invitation:new',
      expect.anything(),
    );
  });

  it('requires an accepted connection', async () => {
    const { service, prisma, presence } = createService();
    (prisma.user.findUnique as jest.Mock).mockImplementation(
      ({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(activeUser(id)),
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockImplementation(
      ({ where: { userId } }: { where: { userId: string } }) =>
        Promise.resolve(
          userId === 'invitee-1'
            ? null
            : { homeId: 'home-a', userId, role: 'OWNER' },
        ),
    );
    (prisma.connection.findUnique as jest.Mock).mockResolvedValue(null);
    (presence.isUserOnline as jest.Mock).mockResolvedValue(true);

    await expect(
      service.createInvitation('user-1', 'invitee-1'),
    ).rejects.toThrow('NOT_A_CONNECTION');
  });

  it('rejects offline invitees', async () => {
    const { service, prisma, presence } = createService();
    (prisma.user.findUnique as jest.Mock).mockImplementation(
      ({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(activeUser(id)),
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockImplementation(
      ({ where: { userId } }: { where: { userId: string } }) =>
        Promise.resolve(
          userId === 'invitee-1'
            ? null
            : { homeId: 'home-a', userId, role: 'OWNER' },
        ),
    );
    (prisma.connection.findUnique as jest.Mock).mockResolvedValue({
      status: ConnectionStatus.accepted,
    });
    (presence.isUserOnline as jest.Mock).mockResolvedValue(false);

    await expect(
      service.createInvitation('user-1', 'invitee-1'),
    ).rejects.toThrow('TARGET_OFFLINE');
  });

  it('blocks invites across two occupied Homes', async () => {
    const { service, prisma, presence } = createService();
    (prisma.user.findUnique as jest.Mock).mockImplementation(
      ({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(activeUser(id)),
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockImplementation(
      ({ where: { userId } }: { where: { userId: string } }) =>
        Promise.resolve({
          homeId: userId === 'invitee-1' ? 'home-b' : 'home-a',
          userId,
          role: 'OWNER',
        }),
    );
    (prisma.connection.findUnique as jest.Mock).mockResolvedValue({
      status: ConnectionStatus.accepted,
    });
    (presence.isUserOnline as jest.Mock).mockResolvedValue(true);

    await expect(
      service.createInvitation('user-1', 'invitee-1'),
    ).rejects.toThrow('USER_ALREADY_IN_ANOTHER_HOME');
  });

  it('rejects duplicate pending invitations', async () => {
    const { service, prisma, presence, homes } = createService();
    mockCreateSuccess(prisma, presence, homes);
    (prisma.homeInvitation.findFirst as jest.Mock).mockResolvedValue({
      id: 'invite-old',
    });

    await expect(
      service.createInvitation('user-1', 'invitee-1'),
    ).rejects.toThrow('INVITATION_ALREADY_PENDING');
  });

  const pendingInvitation = () => ({
    id: 'invite-1',
    homeId: 'home-a',
    inviterId: 'user-1',
    inviteeId: 'invitee-1',
    status: HomeInvitationStatus.PENDING,
    expiresAt: new Date(Date.now() + 10_000),
  });

  it('accepts and returns the Home', async () => {
    const { service, prisma, tx, homes, memberships, rateLimit } =
      createService();
    (prisma.homeInvitation.findUnique as jest.Mock).mockResolvedValue(
      pendingInvitation(),
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'user-1',
      role: 'OWNER',
    });
    (tx.homeInvitation.findUnique as jest.Mock).mockResolvedValue(
      pendingInvitation(),
    );
    (tx.home.findUnique as jest.Mock).mockResolvedValue({ id: 'home-a' });
    (tx.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'user-1',
    });
    (memberships.joinHomeInTx as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'invitee-1',
    });
    (homes.getHomeById as jest.Mock).mockResolvedValue({
      id: 'home-a',
      memberships: [{ userId: 'user-1' }, { userId: 'invitee-1' }],
    });

    const home = await service.acceptInvitation('invitee-1', 'invite-1');

    expect(home).toEqual(
      expect.objectContaining({ id: 'home-a', memberships: expect.any(Array) }),
    );
    expect(tx.homeInvitation.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: {
        status: HomeInvitationStatus.ACCEPTED,
        respondedAt: expect.any(Date),
      },
    });
    expect(rateLimit.assertAllowed).toHaveBeenCalledWith(
      'home:actions:rate:invitee-1',
      60,
      60,
    );
  });

  it('expires stale invitations on accept', async () => {
    const { service, prisma } = createService();
    (prisma.homeInvitation.findUnique as jest.Mock).mockResolvedValue({
      ...pendingInvitation(),
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.acceptInvitation('invitee-1', 'invite-1'),
    ).rejects.toThrow('INVITATION_EXPIRED');
    expect(prisma.homeInvitation.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: {
        status: HomeInvitationStatus.EXPIRED,
        respondedAt: expect.any(Date),
      },
    });
  });

  it('rejects double responses and foreign users', async () => {
    const { service, prisma } = createService();
    (prisma.homeInvitation.findUnique as jest.Mock).mockImplementation(
      ({ where: { id } }: { where: { id: string } }) => {
        if (id === 'accepted-1') {
          return Promise.resolve({
            ...pendingInvitation(),
            id,
            status: HomeInvitationStatus.ACCEPTED,
          });
        }
        return Promise.resolve(pendingInvitation());
      },
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'user-1',
    });

    await expect(
      service.acceptInvitation('invitee-1', 'accepted-1'),
    ).rejects.toThrow('INVITATION_ALREADY_RESPONDED');
    await expect(
      service.acceptInvitation('stranger', 'invite-1'),
    ).rejects.toThrow('INVITATION_ACTION_NOT_ALLOWED');
  });

  it('keeps the invitation pending when the Home is full', async () => {
    const { service, prisma, tx, memberships } = createService();
    (prisma.homeInvitation.findUnique as jest.Mock).mockResolvedValue(
      pendingInvitation(),
    );
    (prisma.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'user-1',
    });
    (tx.homeInvitation.findUnique as jest.Mock).mockResolvedValue(
      pendingInvitation(),
    );
    (tx.home.findUnique as jest.Mock).mockResolvedValue({ id: 'home-a' });
    (tx.homeMembership.findUnique as jest.Mock).mockResolvedValue({
      homeId: 'home-a',
      userId: 'user-1',
    });
    (memberships.joinHomeInTx as jest.Mock).mockRejectedValue(
      new Error('HOME_FULL'),
    );

    await expect(
      service.acceptInvitation('invitee-1', 'invite-1'),
    ).rejects.toThrow('HOME_FULL');
    expect(tx.homeInvitation.update).not.toHaveBeenCalled();
  });

  it('rejects an invitation', async () => {
    const { service, prisma, fanout } = createService();
    (prisma.homeInvitation.findUnique as jest.Mock).mockResolvedValue(
      pendingInvitation(),
    );
    (prisma.homeInvitation.update as jest.Mock).mockResolvedValue({
      ...pendingInvitation(),
      status: HomeInvitationStatus.REJECTED,
    });

    const rejected = await service.rejectInvitation('invitee-1', 'invite-1');

    expect(rejected.status).toBe(HomeInvitationStatus.REJECTED);
    expect(fanout.publishUserEvent).toHaveBeenCalledWith(
      ['user-1', 'invitee-1'],
      'home:changed',
    );
  });

  it('sweeps stale invitations in bulk', async () => {
    const { service, prisma } = createService();
    (prisma.homeInvitation.updateMany as jest.Mock).mockResolvedValue({
      count: 3,
    });

    await expect(service.expireStaleInvitations()).resolves.toBe(3);
    expect(prisma.homeInvitation.updateMany).toHaveBeenCalledWith({
      where: {
        status: HomeInvitationStatus.PENDING,
        expiresAt: { lte: expect.any(Date) },
      },
      data: {
        status: HomeInvitationStatus.EXPIRED,
        respondedAt: expect.any(Date),
      },
    });
  });
});
