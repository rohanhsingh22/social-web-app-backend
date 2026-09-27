import { ForbiddenException } from "@nestjs/common";
import { DirectMessageGateway } from "./direct-message.gateway";
import { DirectMessagesService } from "@app/modules/direct-messages/direct-messages.service";
import { RealtimeAuthService } from "@app/realtime/realtime-auth/realtime-auth.service";
import type { RealtimeSocket } from "@app/realtime/realtime-auth/realtime-auth.service";
import { RealtimeRateLimitService } from "@app/realtime/realtime-rate-limit/realtime-rate-limit.service";

describe("DirectMessageGateway", () => {
  const createGateway = () => {
    const authenticate = jest.fn();
    const getMessages = jest.fn();
    const createMessage = jest.fn();
    const checkDirectMessage = jest.fn();

    const auth = { authenticate } as unknown as RealtimeAuthService;
    const directMessages = {
      getMessages,
      createMessage,
    } as unknown as DirectMessagesService;
    const rateLimit = {
      checkDirectMessage,
    } as unknown as RealtimeRateLimitService;

    const gateway = new DirectMessageGateway(auth, directMessages, rateLimit);
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    } as unknown as DirectMessageGateway["server"];

    return {
      gateway,
      authenticate,
      getMessages,
      createMessage,
      checkDirectMessage,
    };
  };

  const createSocket = (user?: RealtimeSocket["data"]["user"]) => {
    const socket = {
      data: {
        user,
        isGuest: !user,
        joinedDmConversationIds: new Set<string>(),
      },
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as RealtimeSocket;

    return socket;
  };

  it("rejects guest sends without touching the service", async () => {
    const { gateway, createMessage } = createGateway();
    const socket = createSocket();

    await expect(
      gateway.sendDm(socket, { conversationId: "conv-1", body: "hi" }),
    ).resolves.toEqual({ ok: false, code: "AUTH_REQUIRED" });
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("broadcasts sent messages to the room and recipients", async () => {
    const { gateway, createMessage, checkDirectMessage } = createGateway();
    checkDirectMessage.mockResolvedValue({ allowed: true });
    createMessage.mockResolvedValue({
      message: { id: "message-1", body: "hi" },
      recipientUserIds: ["user-b"],
    });
    const socket = createSocket({
      id: "user-a",
      status: "active",
      role: "user",
    });

    await expect(
      gateway.sendDm(socket, { conversationId: "conv-1", body: "hi" }),
    ).resolves.toEqual({
      ok: true,
      message: { id: "message-1", body: "hi" },
    });
  });

  it("maps service denials to ack codes instead of raw errors", async () => {
    const { gateway, createMessage, checkDirectMessage } = createGateway();
    checkDirectMessage.mockResolvedValue({ allowed: true });
    createMessage.mockRejectedValue(new ForbiddenException("BLOCKED"));
    const socket = createSocket({
      id: "user-a",
      status: "active",
      role: "user",
    });

    await expect(
      gateway.sendDm(socket, { conversationId: "conv-1", body: "hi" }),
    ).resolves.toEqual({ ok: false, code: "BLOCKED" });
    expect(socket.emit).toHaveBeenCalledWith(
      "dm:error",
      expect.objectContaining({ code: "BLOCKED" }),
    );
  });

  it("joins only conversations the service authorizes", async () => {
    const { gateway, getMessages } = createGateway();
    getMessages.mockRejectedValue(new ForbiddenException("BLOCKED"));
    const socket = createSocket({
      id: "user-a",
      status: "active",
      role: "user",
    });

    await expect(
      gateway.joinDm(socket, { conversationId: "conv-1" }),
    ).rejects.toThrow(ForbiddenException);
    expect(socket.join).not.toHaveBeenCalled();
  });
});
