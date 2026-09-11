import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ConnectionStatus, UserStatus } from "@prisma/client";
import { RateLimitService } from "@app/common/rate-limit.service";
import { PrismaService } from "@app/core/prisma/prisma.service";
import { ConnectionsService } from "./connections.service";

describe("ConnectionsService", () => {
  const createService = () => {
    const tx = {
      connection: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      block: {
        findFirst: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
      conversation: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn(),
      },
      block: {
        findFirst: jest.fn(),
      },
      connection: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const rateLimit = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitService;

    return {
      service: new ConnectionsService(prisma, rateLimit),
      prisma,
      rateLimit,
      tx,
    };
  };

  const connection = {
    id: "connection-id",
    requesterId: "user-a",
    receiverId: "user-b",
    userLowId: "user-a",
    userHighId: "user-b",
    status: ConnectionStatus.pending,
    createdAt: new Date("2026-09-11T10:00:00.000Z"),
    updatedAt: new Date("2026-09-11T10:00:00.000Z"),
    requester: {
      id: "user-a",
      status: UserStatus.active,
      profile: {
        userId: "user-a",
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
        bio: null,
        ageGroup: null,
        region: null,
        primaryLanguage: null,
        languages: [],
      },
    },
    receiver: {
      id: "user-b",
      status: UserStatus.active,
      profile: {
        userId: "user-b",
        username: "bob",
        displayName: "Bob",
        avatarUrl: null,
        bio: null,
        ageGroup: null,
        region: null,
        primaryLanguage: null,
        languages: [],
      },
    },
  };

  it("creates a pending request with a normalized user pair", async () => {
    const { service, prisma, rateLimit } = createService();
    jest
      .mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        id: "user-b",
        status: UserStatus.active,
      } as never)
      .mockResolvedValueOnce({
        id: "user-a",
        status: UserStatus.active,
      } as never);
    jest.mocked(prisma.block.findFirst).mockResolvedValue(null);
    jest.mocked(prisma.connection.findUnique).mockResolvedValue(null);
    jest
      .mocked(prisma.connection.create)
      .mockResolvedValue(connection as never);

    await expect(service.createRequest("user-b", "user-a")).resolves.toEqual(
      expect.objectContaining({
        id: "connection-id",
        status: ConnectionStatus.pending,
        otherUser: expect.objectContaining({ id: "user-a" }),
      }),
    );
    expect(rateLimit.assertAllowed).toHaveBeenCalledWith(
      "ratelimit:connections:requests:user-b",
      30,
      86_400,
    );
    expect(prisma.connection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requesterId: "user-b",
          receiverId: "user-a",
          userLowId: "user-a",
          userHighId: "user-b",
        }),
      }),
    );
  });

  it("rejects duplicate pending requests", async () => {
    const { service, prisma } = createService();
    jest
      .mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        id: "user-a",
        status: UserStatus.active,
      } as never)
      .mockResolvedValueOnce({
        id: "user-b",
        status: UserStatus.active,
      } as never);
    jest.mocked(prisma.block.findFirst).mockResolvedValue(null);
    jest
      .mocked(prisma.connection.findUnique)
      .mockResolvedValue(connection as never);

    await expect(service.createRequest("user-a", "user-b")).rejects.toThrow(
      ConflictException,
    );
  });

  it("rejects requests when either user blocked the other", async () => {
    const { service, prisma } = createService();
    jest
      .mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        id: "user-a",
        status: UserStatus.active,
      } as never)
      .mockResolvedValueOnce({
        id: "user-b",
        status: UserStatus.active,
      } as never);
    jest
      .mocked(prisma.block.findFirst)
      .mockResolvedValue({ id: "block-id" } as never);

    await expect(service.createRequest("user-a", "user-b")).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("accepts a pending request and creates a direct conversation", async () => {
    const { service, tx } = createService();
    tx.connection.findUnique.mockResolvedValue(connection);
    tx.block.findFirst.mockResolvedValue(null);
    tx.user.findMany.mockResolvedValue([
      { id: "user-a", status: UserStatus.active },
      { id: "user-b", status: UserStatus.active },
    ]);
    tx.connection.update.mockResolvedValue({
      ...connection,
      status: ConnectionStatus.accepted,
    });
    tx.conversation.findFirst.mockResolvedValue(null);
    tx.conversation.create.mockResolvedValue({
      id: "conversation-id",
      type: "direct",
      createdAt: new Date("2026-09-11T10:01:00.000Z"),
      updatedAt: new Date("2026-09-11T10:01:00.000Z"),
    });

    await expect(service.accept("user-b", "connection-id")).resolves.toEqual({
      connection: expect.objectContaining({
        id: "connection-id",
        status: ConnectionStatus.accepted,
      }),
      conversation: expect.objectContaining({ id: "conversation-id" }),
    });
    expect(tx.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          type: "direct",
          members: {
            create: [{ userId: "user-a" }, { userId: "user-b" }],
          },
        },
      }),
    );
  });

  it("hides missing connections as not found", async () => {
    const { service, prisma } = createService();
    jest.mocked(prisma.connection.findUnique).mockResolvedValue(null);

    await expect(service.reject("user-b", "missing")).rejects.toThrow(
      NotFoundException,
    );
  });
});
