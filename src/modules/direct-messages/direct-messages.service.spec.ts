import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ConnectionStatus, MessageStatus, UserStatus } from "@prisma/client";
import { PrismaService } from "@app/core/prisma/prisma.service";
import { ModerationService } from "@app/modules/moderation/moderation.service";
import { NotificationsService } from "@app/modules/notifications/notifications.service";
import { DirectMessagesService } from "./direct-messages.service";

describe("DirectMessagesService", () => {
  const now = new Date("2026-09-11T10:00:00.000Z");

  const profile = (userId: string, username: string) => ({
    userId,
    username,
    displayName: username,
    avatarUrl: null,
    bio: null,
    ageGroup: null,
    region: null,
    primaryLanguage: null,
    languages: [],
  });

  const conversation = {
    id: "conversation-id",
    type: "direct",
    createdAt: now,
    updatedAt: now,
    members: [
      {
        conversationId: "conversation-id",
        userId: "user-a",
        createdAt: now,
        user: { id: "user-a", profile: profile("user-a", "alice") },
      },
      {
        conversationId: "conversation-id",
        userId: "user-b",
        createdAt: now,
        user: { id: "user-b", profile: profile("user-b", "bob") },
      },
    ],
  };

  const message = {
    id: "message-id",
    conversationId: "conversation-id",
    senderId: "user-a",
    body: "Hello there",
    status: MessageStatus.active,
    createdAt: now,
    updatedAt: now,
    sender: {
      id: "user-a",
      profile: {
        username: "alice",
        displayName: "alice",
        avatarUrl: null,
      },
    },
  };

  const createService = () => {
    const prisma = {
      conversationMember: {
        findMany: jest.fn(),
      },
      conversation: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      directMessage: {
        findMany: jest.fn(),
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      block: {
        findFirst: jest.fn(),
      },
      connection: {
        findUnique: jest.fn(),
      },
    } as unknown as PrismaService;
    const moderation = {
      assertMessageAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as ModerationService;
    const notifications = {
      newDirectMessage: jest.fn().mockResolvedValue({ id: "notification-1" }),
    } as unknown as NotificationsService;

    return {
      service: new DirectMessagesService(prisma, moderation, notifications),
      prisma,
      moderation,
      notifications,
    };
  };

  const allowDirectMessage = (prisma: PrismaService) => {
    jest.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-a",
      status: UserStatus.active,
    } as never);
    jest.mocked(prisma.block.findFirst).mockResolvedValue(null);
    jest.mocked(prisma.connection.findUnique).mockResolvedValue({
      id: "connection-id",
      status: ConnectionStatus.accepted,
    } as never);
  };

  it("lists conversations with their latest active message", async () => {
    const { service, prisma } = createService();
    jest.mocked(prisma.conversationMember.findMany).mockResolvedValue([
      {
        conversationId: "conversation-id",
        userId: "user-a",
        createdAt: now,
        conversation: {
          ...conversation,
          messages: [message],
        },
      },
    ] as never);

    await expect(service.listConversations("user-a")).resolves.toEqual([
      expect.objectContaining({
        id: "conversation-id",
        latestMessage: expect.objectContaining({
          id: "message-id",
          body: "Hello there",
        }),
      }),
    ]);
  });

  it("rejects message reads for users outside the conversation", async () => {
    const { service, prisma } = createService();
    jest
      .mocked(prisma.conversation.findUnique)
      .mockResolvedValue(conversation as never);

    await expect(
      service.createMessage("user-a", "conversation-id", "Hello"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("returns the unified identity card on message senders", async () => {
    const { service, prisma } = createService();
    jest
      .mocked(prisma.conversation.findUnique)
      .mockResolvedValue(conversation as never);
    allowDirectMessage(prisma);
    jest.mocked(prisma.directMessage.create).mockResolvedValue({
      ...message,
      sender: {
        id: "user-a",
        profile: {
          username: "alice",
          displayName: "alice",
          avatarUrl: null,
          profilePictureType: "toli",
          toliAvatarKey: "vector_01",
          toli: { id: "toli-id", name: "Vector" },
        },
      },
    } as never);
    jest
      .mocked(prisma.conversation.update)
      .mockResolvedValue({ id: "conversation-id" } as never);

    await expect(
      service.createMessage("user-a", "conversation-id", "Hello there"),
    ).resolves.toEqual(
      expect.objectContaining({
        message: expect.objectContaining({
          sender: expect.objectContaining({
            profile: expect.objectContaining({
              displayName: "alice",
              profilePicture: expect.objectContaining({
                type: "toli",
                toliAvatarKey: "vector_01",
              }),
              toli: { id: "toli-id", name: "Vector" },
            }),
          }),
        }),
      }),
    );
  });

  it("hides missing conversations as not found", async () => {
    const { service, prisma } = createService();
    jest.mocked(prisma.conversation.findUnique).mockResolvedValue(null);

    await expect(
      service.getMessages("user-a", "missing-conversation-id"),
    ).rejects.toThrow(NotFoundException);
  });

  it("allows muted users to read direct-message history", async () => {
    const { service, prisma } = createService();
    jest
      .mocked(prisma.conversation.findUnique)
      .mockResolvedValue(conversation as never);
    jest.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-a",
      status: UserStatus.muted,
    } as never);
    jest.mocked(prisma.block.findFirst).mockResolvedValue(null);
    jest.mocked(prisma.connection.findUnique).mockResolvedValue({
      id: "connection-id",
      status: ConnectionStatus.accepted,
    } as never);
    jest.mocked(prisma.directMessage.findMany).mockResolvedValue([
      message,
    ] as never);

    await expect(
      service.getMessages("user-a", "conversation-id"),
    ).resolves.toEqual(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            id: "message-id",
            body: "Hello there",
          }),
        ],
      }),
    );
  });

  it("creates a normalized message for accepted direct connections", async () => {
    const { service, prisma } = createService();
    jest
      .mocked(prisma.conversation.findUnique)
      .mockResolvedValue(conversation as never);
    allowDirectMessage(prisma);
    jest.mocked(prisma.directMessage.create).mockResolvedValue(message as never);
    jest
      .mocked(prisma.conversation.update)
      .mockResolvedValue({ id: "conversation-id" } as never);

    await expect(
      service.createMessage("user-a", "conversation-id", "  Hello   there  "),
    ).resolves.toEqual({
      message: expect.objectContaining({
        id: "message-id",
        body: "Hello there",
      }),
      recipientUserIds: ["user-b"],
    });
    expect(prisma.directMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: "Hello there",
          conversationId: "conversation-id",
          senderId: "user-a",
        }),
      }),
    );
  });

  it("notifies recipients after persisting a direct message", async () => {
    const { service, prisma, notifications } = createService();
    jest
      .mocked(prisma.conversation.findUnique)
      .mockResolvedValue(conversation as never);
    allowDirectMessage(prisma);
    jest.mocked(prisma.directMessage.create).mockResolvedValue(message as never);
    jest
      .mocked(prisma.conversation.update)
      .mockResolvedValue({ id: "conversation-id" } as never);

    await service.createMessage("user-a", "conversation-id", "Hello there");

    expect(notifications.newDirectMessage).toHaveBeenCalledWith(
      "user-b",
      expect.objectContaining({
        senderId: "user-a",
        conversationId: "conversation-id",
        messageId: "message-id",
      }),
    );
  });

  it("requires an accepted connection before creating messages", async () => {
    const { service, prisma } = createService();
    jest
      .mocked(prisma.conversation.findUnique)
      .mockResolvedValue(conversation as never);
    jest.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-a",
      status: UserStatus.active,
    } as never);
    jest.mocked(prisma.block.findFirst).mockResolvedValue(null);
    jest.mocked(prisma.connection.findUnique).mockResolvedValue({
      id: "connection-id",
      status: ConnectionStatus.pending,
    } as never);

    await expect(
      service.createMessage("user-a", "conversation-id", "Hello"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("prevents muted users from creating direct messages", async () => {
    const { service, prisma } = createService();
    jest
      .mocked(prisma.conversation.findUnique)
      .mockResolvedValue(conversation as never);
    jest.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-a",
      status: UserStatus.muted,
    } as never);
    jest.mocked(prisma.block.findFirst).mockResolvedValue(null);
    jest.mocked(prisma.connection.findUnique).mockResolvedValue({
      id: "connection-id",
      status: ConnectionStatus.accepted,
    } as never);

    await expect(
      service.createMessage("user-a", "conversation-id", "Hello"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects empty direct-message bodies", () => {
    const { service } = createService();

    expect(() => service.normalizeBody("   ")).toThrow(BadRequestException);
  });
});
