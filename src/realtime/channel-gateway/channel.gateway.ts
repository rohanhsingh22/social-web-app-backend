import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: '/channels',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChannelGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('channel:join')
  async joinChannel(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { channelId?: string },
  ) {
    if (!body.channelId) {
      return { ok: false, code: 'CHANNEL_REQUIRED' };
    }

    await socket.join(`channel:${body.channelId}`);
    return { ok: true, channelId: body.channelId };
  }

  @SubscribeMessage('channel:leave')
  async leaveChannel(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { channelId?: string },
  ) {
    if (body.channelId) {
      await socket.leave(`channel:${body.channelId}`);
    }

    return { ok: true };
  }

  @SubscribeMessage('channel:message:send')
  sendChannelMessage() {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'Authenticated channel message flow is implemented in Phase 5.',
    };
  }
}
