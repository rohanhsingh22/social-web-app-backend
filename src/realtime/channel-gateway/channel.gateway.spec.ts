import { ChannelGateway } from './channel.gateway';
import { ChannelsService } from '@app/modules/channels/channels.service';
import { PresenceService } from '@app/realtime/presence/presence.service';
import { RealtimeAuthService } from '@app/realtime/realtime-auth/realtime-auth.service';
import { RealtimeRateLimitService } from '@app/realtime/realtime-rate-limit/realtime-rate-limit.service';
import { RealtimeSocket } from '@app/realtime/realtime-auth/realtime-auth.service';

describe('ChannelGateway', () => {
  const createGateway = () => {
    const authenticate = jest.fn();
    const getBySlugOrId = jest.fn();
    const getToliChannelById = jest.fn();
    const hasToliChannelAccess = jest.fn().mockResolvedValue(true);
    const persistChannelMessage = jest.fn();
    const markOnline = jest.fn();
    const markOffline = jest.fn();
    const joinChannel = jest.fn();
    const leaveChannel = jest.fn();
    const onlineCount = jest.fn();
    const checkChannelMessage = jest.fn();

    const auth = { authenticate } as unknown as RealtimeAuthService;
    const channels = {
      getBySlugOrId,
      getToliChannelById,
      hasToliChannelAccess,
      persistChannelMessage,
    } as unknown as ChannelsService;
    const presence = {
      markOnline,
      markOffline,
      joinChannel,
      leaveChannel,
      onlineCount,
    } as unknown as PresenceService;
    const rateLimit = {
      checkChannelMessage,
    } as unknown as RealtimeRateLimitService;

    const gateway = new ChannelGateway(auth, channels, presence, rateLimit);
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    } as unknown as ChannelGateway['server'];

    return {
      gateway,
      authenticate,
      getBySlugOrId,
      getToliChannelById,
      hasToliChannelAccess,
      persistChannelMessage,
      markOnline,
      markOffline,
      joinChannel,
      leaveChannel,
      checkChannelMessage,
    };
  };

  const createSocket = (user?: RealtimeSocket['data']['user']) => {
    const joinedChannelIds = new Set<string>();
    const socket = {
      data: { user, isGuest: !user, joinedChannelIds },
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as RealtimeSocket;

    return socket;
  };

  it('marks an authenticated socket online on connect', async () => {
    const { gateway, authenticate, markOnline } = createGateway();
    const socket = createSocket();
    authenticate.mockImplementation(async (s: RealtimeSocket) => {
      s.data.user = { id: 'user-1', status: 'active', role: 'user' };
    });

    await gateway.handleConnection(socket);

    expect(markOnline).toHaveBeenCalledWith('user-1', undefined);
  });

  it('disconnects a socket with an invalid token', async () => {
    const { gateway, authenticate } = createGateway();
    const socket = createSocket();
    authenticate.mockRejectedValue(new Error('invalid'));

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.emit).toHaveBeenCalledWith('auth:error', expect.any(Object));
  });

  it('joins a channel and records authenticated presence', async () => {
    const { gateway, getBySlugOrId, joinChannel } = createGateway();
    getBySlugOrId.mockResolvedValue({ id: 'channel-1' });
    const socket = createSocket({
      id: 'user-1',
      status: 'active',
      role: 'user',
    });

    await expect(
      gateway.joinChannel(socket, { channelId: 'channel-1' }),
    ).resolves.toEqual({ ok: true, channelId: 'channel-1' });

    expect(socket.join).toHaveBeenCalledWith('channel:channel-1');
    expect(socket.data.joinedChannelIds.has('channel-1')).toBe(true);
    expect(joinChannel).toHaveBeenCalledWith('channel-1', 'user-1');
  });

  it('does not double-count presence on duplicate join', async () => {
    const { gateway, getBySlugOrId, joinChannel } = createGateway();
    getBySlugOrId.mockResolvedValue({ id: 'channel-1' });
    const socket = createSocket({
      id: 'user-1',
      status: 'active',
      role: 'user',
    });

    await gateway.joinChannel(socket, { channelId: 'channel-1' });
    await gateway.joinChannel(socket, { channelId: 'channel-1' });

    expect(joinChannel).toHaveBeenCalledTimes(1);
  });

  it('leaves a channel and clears presence', async () => {
    const { gateway, getBySlugOrId, leaveChannel } = createGateway();
    getBySlugOrId.mockResolvedValue({ id: 'channel-1' });
    const socket = createSocket({
      id: 'user-1',
      status: 'active',
      role: 'user',
    });

    await gateway.joinChannel(socket, { channelId: 'channel-1' });
    await gateway.leaveChannel(socket, { channelId: 'channel-1' });

    expect(socket.leave).toHaveBeenCalledWith('channel:channel-1');
    expect(socket.data.joinedChannelIds.has('channel-1')).toBe(false);
    expect(leaveChannel).toHaveBeenCalledWith('channel-1', 'user-1');
  });

  it('rejects a guest message send', async () => {
    const { gateway } = createGateway();
    const socket = createSocket();

    await expect(
      gateway.sendChannelMessage(socket, {
        channelId: 'channel-1',
        body: 'hello',
      }),
    ).resolves.toEqual({ ok: false, code: 'AUTH_REQUIRED' });
  });

  it('rejects an empty message body', async () => {
    const { gateway } = createGateway();
    const socket = createSocket({ id: 'user-1', status: 'active', role: 'user' });

    await expect(
      gateway.sendChannelMessage(socket, { channelId: 'channel-1', body: '   ' }),
    ).resolves.toEqual({ ok: false, code: 'MESSAGE_REQUIRED' });
  });

  it('persists and broadcasts a valid channel message', async () => {
    const {
      gateway,
      getBySlugOrId,
      persistChannelMessage,
      checkChannelMessage,
    } = createGateway();
    getBySlugOrId.mockResolvedValue({ id: 'channel-1', toliId: null });
    persistChannelMessage.mockResolvedValue({ id: 'message-1', body: 'hello' });
    checkChannelMessage.mockResolvedValue({ allowed: true });
    const socket = createSocket({ id: 'user-1', status: 'active', role: 'user' });

    await expect(
      gateway.sendChannelMessage(socket, {
        channelId: 'channel-1',
        body: '  hello  ',
      }),
    ).resolves.toEqual({ ok: true, message: { id: 'message-1', body: 'hello' } });

    expect(persistChannelMessage).toHaveBeenCalledWith(
      'channel-1',
      'user-1',
      'hello',
    );
    expect(checkChannelMessage).toHaveBeenCalledWith('user-1', 'channel-1');
  });

  it('cleans up channel presence on disconnect using tracked joins', async () => {
    const { gateway, getBySlugOrId, markOffline, leaveChannel } = createGateway();
    getBySlugOrId.mockResolvedValue({ id: 'channel-1' });
    const socket = createSocket({ id: 'user-1', status: 'active', role: 'user' });

    await gateway.joinChannel(socket, { channelId: 'channel-1' });
    await gateway.handleDisconnect(socket);

    expect(markOffline).toHaveBeenCalledWith('user-1', undefined);
    expect(leaveChannel).toHaveBeenCalledWith('channel-1', 'user-1');
  });

  it('rejects Toli room joins for guests and other Tolies', async () => {
    const {
      gateway,
      getBySlugOrId,
      getToliChannelById,
      hasToliChannelAccess,
    } = createGateway();
    getBySlugOrId.mockRejectedValue(new Error('not public'));
    getToliChannelById.mockResolvedValue({
      id: 'toli-channel-1',
      toliId: 'vector-id',
    });

    const guest = createSocket();
    await expect(
      gateway.joinChannel(guest, { channelId: 'toli-channel-1' }),
    ).resolves.toEqual({ ok: false, code: 'AUTH_REQUIRED' });

    hasToliChannelAccess.mockResolvedValue(false);
    const outsider = createSocket({
      id: 'user-2',
      status: 'active',
      role: 'user',
    });
    await expect(
      gateway.joinChannel(outsider, { channelId: 'toli-channel-1' }),
    ).resolves.toEqual({ ok: false, code: 'TOLI_FORBIDDEN' });
    expect(outsider.join).not.toHaveBeenCalled();

    hasToliChannelAccess.mockResolvedValue(true);
    const member = createSocket({
      id: 'user-1',
      status: 'active',
      role: 'user',
    });
    await expect(
      gateway.joinChannel(member, { channelId: 'toli-channel-1' }),
    ).resolves.toEqual({ ok: true, channelId: 'toli-channel-1' });
  });

  it('rejects Toli room sends from other Tolies', async () => {
    const {
      gateway,
      getBySlugOrId,
      getToliChannelById,
      hasToliChannelAccess,
      persistChannelMessage,
    } = createGateway();
    getBySlugOrId.mockRejectedValue(new Error('not public'));
    getToliChannelById.mockResolvedValue({
      id: 'toli-channel-1',
      toliId: 'vector-id',
    });
    hasToliChannelAccess.mockResolvedValue(false);
    const socket = createSocket({
      id: 'user-2',
      status: 'active',
      role: 'user',
    });

    await expect(
      gateway.sendChannelMessage(socket, {
        channelId: 'toli-channel-1',
        body: 'hello',
      }),
    ).resolves.toEqual({ ok: false, code: 'TOLI_FORBIDDEN' });
    expect(socket.emit).toHaveBeenCalledWith(
      'channel:error',
      expect.objectContaining({ code: 'TOLI_FORBIDDEN' }),
    );
    expect(persistChannelMessage).not.toHaveBeenCalled();
  });
});
