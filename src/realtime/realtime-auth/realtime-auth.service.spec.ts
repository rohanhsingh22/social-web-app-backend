import { AuthService } from '@app/modules/auth/auth.service';
import {
  RealtimeAuthService,
  RealtimeSocket,
} from './realtime-auth.service';

describe('RealtimeAuthService', () => {
  const createService = () => {
    const verifyAccessToken = jest.fn();
    const authService = { verifyAccessToken } as unknown as AuthService;
    const service = new RealtimeAuthService(authService);

    return { service, verifyAccessToken };
  };

  const createSocket = (headers: Record<string, string>) => {
    const data: RealtimeSocket['data'] = { isGuest: true };
    return {
      data,
      handshake: { headers, auth: {} },
    } as unknown as RealtimeSocket;
  };

  it('marks a socket as guest when no token is present', async () => {
    const { service, verifyAccessToken } = createService();
    const socket = createSocket({});

    await service.authenticate(socket);

    expect(socket.data.isGuest).toBe(true);
    expect(socket.data.user).toBeUndefined();
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('authenticates a socket from a bearer token', async () => {
    const { service, verifyAccessToken } = createService();
    verifyAccessToken.mockResolvedValue({
      id: 'user-id',
      status: 'active',
      role: 'user',
    });
    const socket = createSocket({ authorization: 'Bearer access-token' });

    await service.authenticate(socket);

    expect(socket.data.isGuest).toBe(false);
    expect(socket.data.user).toEqual({
      id: 'user-id',
      status: 'active',
      role: 'user',
    });
    expect(verifyAccessToken).toHaveBeenCalledWith('access-token');
  });

  it('authenticates a socket from the access_token cookie', async () => {
    const { service, verifyAccessToken } = createService();
    verifyAccessToken.mockResolvedValue({
      id: 'user-id',
      status: 'active',
      role: 'user',
    });
    const socket = createSocket({ cookie: 'access_token=cookie-token' });

    await service.authenticate(socket);

    expect(verifyAccessToken).toHaveBeenCalledWith('cookie-token');
  });
});
