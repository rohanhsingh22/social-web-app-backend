import { NotificationsGateway } from './notifications.gateway';
import { RedisService } from '@app/core/redis/redis.service';
import { RealtimeAuthService } from '@app/realtime/realtime-auth/realtime-auth.service';
import { RealtimeSocket } from '@app/realtime/realtime-auth/realtime-auth.service';
import { REALTIME_FANOUT_CHANNEL } from '@app/realtime/fanout/fanout.service';

describe('NotificationsGateway', () => {
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

    const gateway = new NotificationsGateway(auth, redis);
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as unknown as NotificationsGateway['server'];

    return { gateway, authenticate, subscriber, handlers, to, emit };
  };

  const createSocket = (user?: RealtimeSocket['data']['user']) => {
    const socket = {
      data: { user },
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as RealtimeSocket;

    return socket;
  };

  it('joins the per-user room on authenticated connect', async () => {
    const { gateway, authenticate } = createGateway();
    authenticate.mockImplementation(async (socket: RealtimeSocket) => {
      socket.data.user = { id: 'user-1', status: 'active', role: 'user' };
    });
    const socket = createSocket();

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('user:user-1');
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

  it('subscribes to the fanout channel on init', async () => {
    const { gateway, subscriber } = createGateway();

    await gateway.onModuleInit();

    expect(subscriber.subscribe).toHaveBeenCalledWith(REALTIME_FANOUT_CHANNEL);
  });

  it('re-emits connection changes into per-user rooms', async () => {
    const { gateway, handlers, to, emit } = createGateway();

    await gateway.onModuleInit();
    handlers['message'](
      REALTIME_FANOUT_CHANNEL,
      JSON.stringify({
        event: 'connection:changed',
        userIds: ['user-a', 'user-b'],
      }),
    );

    expect(to).toHaveBeenCalledWith('user:user-a');
    expect(to).toHaveBeenCalledWith('user:user-b');
    expect(emit).toHaveBeenCalledWith(
      'connection:changed',
      expect.objectContaining({ userIds: ['user-a', 'user-b'] }),
    );
  });

  it('ignores malformed and unknown fanout messages', async () => {
    const { gateway, handlers, to } = createGateway();

    await gateway.onModuleInit();
    handlers['message'](REALTIME_FANOUT_CHANNEL, 'not-json');
    handlers['message'](
      REALTIME_FANOUT_CHANNEL,
      JSON.stringify({ event: 'nope', userIds: ['user-a'] }),
    );

    expect(to).not.toHaveBeenCalled();
  });
});
