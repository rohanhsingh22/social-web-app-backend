import { HomeGateway } from './home.gateway';
import { RedisService } from '@app/core/redis/redis.service';
import { RealtimeAuthService } from '@app/realtime/realtime-auth/realtime-auth.service';
import { RealtimeSocket } from '@app/realtime/realtime-auth/realtime-auth.service';
import { PresenceService } from '@app/realtime/presence/presence.service';
import { REALTIME_FANOUT_CHANNEL } from '@app/realtime/fanout/fanout.service';

describe('HomeGateway', () => {
  const createGateway = () => {
    const authenticate = jest.fn();
    const handlers: Record<string, (channel: string, message: string) => void> =
      {};
    const subscriber = {
      status: 'ready',
      connect: jest.fn(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      quit: jest.fn(),
      on: jest.fn(
        (
          event: string,
          handler: (channel: string, message: string) => void,
        ) => {
          handlers[event] = handler;
        },
      ),
    };
    const connection = {
      duplicate: jest.fn().mockReturnValue(subscriber),
    };
    const auth = { authenticate } as unknown as RealtimeAuthService;
    const redis = { connection } as unknown as RedisService;
    const presence = {
      markOnline: jest.fn(),
      markOffline: jest.fn(),
      refreshSocket: jest.fn(),
    } as unknown as PresenceService;

    const gateway = new HomeGateway(auth, redis, presence);
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as unknown as HomeGateway['server'];

    return { gateway, authenticate, subscriber, handlers, to, emit, presence };
  };

  const createSocket = (user?: RealtimeSocket['data']['user']) => {
    const socket = {
      id: 'socket-1',
      data: { user },
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as RealtimeSocket;

    return socket;
  };

  it('joins the per-user room on authenticated connect', async () => {
    const { gateway, authenticate, presence } = createGateway();
    authenticate.mockImplementation(async (socket: RealtimeSocket) => {
      socket.data.user = { id: 'user-1', status: 'active', role: 'user' };
    });
    const socket = createSocket();

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('user:user-1');
    expect(presence.markOnline).toHaveBeenCalledWith('user-1', 'socket-1');
  });

  it('clears presence on disconnect without touching membership', async () => {
    const { gateway, presence } = createGateway();
    const socket = createSocket({
      id: 'user-1',
      status: 'active',
      role: 'user',
    });

    await gateway.handleDisconnect(socket);

    expect(presence.markOffline).toHaveBeenCalledWith('user-1', 'socket-1');
    expect(socket.leave).toHaveBeenCalledWith('user:user-1');
  });

  it('refreshes presence on heartbeat', async () => {
    const { gateway, presence } = createGateway();
    const socket = createSocket({
      id: 'user-1',
      status: 'active',
      role: 'user',
    });

    await expect(gateway.heartbeat(socket)).resolves.toEqual({ ok: true });
    expect(presence.refreshSocket).toHaveBeenCalledWith('user-1', 'socket-1');
  });

  it('disconnects sockets without a user', async () => {
    const { gateway, authenticate } = createGateway();
    authenticate.mockResolvedValue(undefined);
    const socket = createSocket();

    await gateway.handleConnection(socket);

    expect(socket.emit).toHaveBeenCalledWith(
      'auth:error',
      expect.objectContaining({ code: 'AUTH_REQUIRED' }),
    );
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('treats socket disconnect as connectivity loss, never as leave', async () => {
    const { gateway } = createGateway();
    const socket = createSocket({
      id: 'user-1',
      status: 'active',
      role: 'user',
    });

    await gateway.handleDisconnect(socket);

    // Only the socket room is left; membership is untouched (no Prisma here).
    expect(socket.leave).toHaveBeenCalledWith('user:user-1');
  });

  it('subscribes to the fanout channel on init', async () => {
    const { gateway, subscriber } = createGateway();

    await gateway.onModuleInit();

    expect(subscriber.subscribe).toHaveBeenCalledWith(REALTIME_FANOUT_CHANNEL);
  });

  it('emits home:state for membership changes', async () => {
    const { gateway, handlers, to, emit } = createGateway();

    await gateway.onModuleInit();
    handlers['message'](
      REALTIME_FANOUT_CHANNEL,
      JSON.stringify({ event: 'home:changed', userIds: ['user-a', 'user-b'] }),
    );

    expect(to).toHaveBeenCalledWith('user:user-a');
    expect(to).toHaveBeenCalledWith('user:user-b');
    expect(emit).toHaveBeenCalledWith(
      'home:state',
      expect.objectContaining({ userIds: ['user-a', 'user-b'] }),
    );
  });

  it('pushes new invitations with their payload', async () => {
    const { gateway, handlers, to, emit } = createGateway();
    const invitation = {
      id: 'invite-1',
      homeId: 'home-a',
      inviterId: 'user-1',
      inviteeId: 'user-2',
      expiresAt: '2026-10-05T00:00:20.000Z',
    };

    await gateway.onModuleInit();
    handlers['message'](
      REALTIME_FANOUT_CHANNEL,
      JSON.stringify({
        event: 'home:invitation:new',
        userIds: ['user-1', 'user-2'],
        invitation,
      }),
    );

    expect(to).toHaveBeenCalledWith('user:user-2');
    expect(emit).toHaveBeenCalledWith(
      'home:invitation:new',
      expect.objectContaining({ invitation }),
    );
  });

  it('pushes new join requests with their payload', async () => {
    const { gateway, handlers, to, emit } = createGateway();
    const joinRequest = {
      id: 'request-1',
      homeId: 'home-b',
      requesterId: 'user-3',
      targetMemberId: 'user-4',
      expiresAt: '2026-10-05T00:00:20.000Z',
    };

    await gateway.onModuleInit();
    handlers['message'](
      REALTIME_FANOUT_CHANNEL,
      JSON.stringify({
        event: 'home:join-request:new',
        userIds: ['user-3', 'user-4'],
        joinRequest,
      }),
    );

    expect(to).toHaveBeenCalledWith('user:user-4');
    expect(emit).toHaveBeenCalledWith(
      'home:join-request:new',
      expect.objectContaining({ joinRequest }),
    );
  });

  it('ignores malformed, foreign, and misshapen fanout messages', async () => {
    const { gateway, handlers, to } = createGateway();

    await gateway.onModuleInit();
    handlers['message'](REALTIME_FANOUT_CHANNEL, 'not-json');
    handlers['message'](
      REALTIME_FANOUT_CHANNEL,
      JSON.stringify({ event: 'connection:changed', userIds: ['user-a'] }),
    );
    handlers['message'](
      REALTIME_FANOUT_CHANNEL,
      JSON.stringify({
        event: 'home:invitation:new',
        userIds: ['user-1'],
        invitation: { id: 'invite-1' },
      }),
    );

    expect(to).not.toHaveBeenCalled();
  });
});
