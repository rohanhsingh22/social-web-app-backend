import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';

@WebSocketGateway({
  namespace: '/dm',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class DirectMessageGateway {
  @SubscribeMessage('dm:join')
  joinDm() {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'DM rooms require authenticated accepted connections.',
    };
  }

  @SubscribeMessage('dm:leave')
  async leaveDm(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { conversationId?: string },
  ) {
    if (body.conversationId) {
      await socket.leave(`dm:${body.conversationId}`);
    }

    return { ok: true };
  }

  @SubscribeMessage('dm:message:send')
  sendDm() {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'Authenticated DM send flow is implemented in Phase 7.',
    };
  }
}
