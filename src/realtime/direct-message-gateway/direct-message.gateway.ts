import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server } from "socket.io";
import { DirectMessagesService } from "@app/modules/direct-messages/direct-messages.service";
import {
  RealtimeAuthService,
  RealtimeSocket,
} from "@app/realtime/realtime-auth/realtime-auth.service";
import { RealtimeRateLimitService } from "@app/realtime/realtime-rate-limit/realtime-rate-limit.service";

type DmPayload = { conversationId?: string };
type SendPayload = DmPayload & { body?: string };

@WebSocketGateway({
  namespace: "/dm",
  cors: {
    origin: true,
    credentials: true,
  },
})
export class DirectMessageGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly directMessages: DirectMessagesService,
    private readonly rateLimit: RealtimeRateLimitService,
  ) {}

  async handleConnection(socket: RealtimeSocket) {
    try {
      await this.auth.authenticate(socket);
    } catch {
      socket.emit("auth:error", {
        code: "INVALID_ACCESS_TOKEN",
        message: "Your session is invalid or expired.",
      });
      socket.disconnect(true);
      return;
    }

    const user = socket.data.user;

    if (!user) {
      socket.emit("auth:error", { code: "AUTH_REQUIRED" });
      socket.disconnect(true);
      return;
    }

    await socket.join(`user:${user.id}`);
  }

  async handleDisconnect(socket: RealtimeSocket) {
    const user = socket.data.user;

    if (!user) {
      return;
    }

    await socket.leave(`user:${user.id}`);
  }

  @SubscribeMessage("dm:join")
  async joinDm(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: DmPayload,
  ) {
    const user = socket.data.user;

    if (!user) {
      return { ok: false, code: "AUTH_REQUIRED" };
    }

    if (!body.conversationId) {
      return { ok: false, code: "CONVERSATION_REQUIRED" };
    }

    await this.directMessages.getMessages(
      user.id,
      body.conversationId,
      undefined,
      "1",
    );
    await socket.join(`dm:${body.conversationId}`);
    socket.data.joinedDmConversationIds.add(body.conversationId);

    return { ok: true, conversationId: body.conversationId };
  }

  @SubscribeMessage("dm:leave")
  async leaveDm(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: DmPayload,
  ) {
    if (body.conversationId) {
      await socket.leave(`dm:${body.conversationId}`);
      socket.data.joinedDmConversationIds.delete(body.conversationId);
    }

    return { ok: true };
  }

  @SubscribeMessage("dm:message:send")
  async sendDm(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: SendPayload,
  ) {
    const user = socket.data.user;

    if (!user) {
      return { ok: false, code: "AUTH_REQUIRED" };
    }

    if (!body.conversationId) {
      return { ok: false, code: "CONVERSATION_REQUIRED" };
    }

    if (!body.body) {
      return { ok: false, code: "MESSAGE_REQUIRED" };
    }

    const rateLimit = await this.rateLimit.checkDirectMessage(user.id);

    if (!rateLimit.allowed) {
      socket.emit("dm:error", {
        code: "RATE_LIMITED",
        retryAfterMs: rateLimit.retryAfterMs,
      });
      return { ok: false, code: "RATE_LIMITED" };
    }

    const result = await this.directMessages.createMessage(
      user.id,
      body.conversationId,
      body.body,
    );

    this.server
      .to(`dm:${body.conversationId}`)
      .emit("dm:message:new", result.message);

    for (const recipientUserId of result.recipientUserIds) {
      this.server.to(`user:${recipientUserId}`).emit("dm:message:new", {
        ...result.message,
        notification: true,
      });
    }

    return { ok: true, message: result.message };
  }
}
