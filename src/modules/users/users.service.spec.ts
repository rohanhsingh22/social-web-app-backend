import { ConnectionStatus } from "@prisma/client";
import { RateLimitService } from "@app/common/rate-limit.service";
import { PrismaService } from "@app/core/prisma/prisma.service";
import { UsersService } from "./users.service";

describe("UsersService", () => {
  const createService = () => {
    const prisma = {
      user: {
        findFirst: jest.fn(),
      },
      connection: {
        findFirst: jest.fn(),
      },
    } as unknown as PrismaService;
    const rateLimit = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitService;

    return {
      service: new UsersService(prisma, rateLimit),
      prisma,
      rateLimit,
    };
  };

  it("rate limits and returns no results for invalid public IDs without querying", async () => {
    const { service, prisma, rateLimit } = createService();

    await expect(service.search("viewer-id", "a")).resolves.toEqual([]);
    await expect(service.search("viewer-id", "rohan")).resolves.toEqual([]);
    await expect(service.search("viewer-id", "HT-7K4")).resolves.toEqual([]);
    await expect(service.search("viewer-id", "Rohan")).resolves.toEqual([]);

    expect(rateLimit.assertAllowed).toHaveBeenCalledWith(
      "ratelimit:users:search:viewer-id",
      60,
      60,
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("looks up an exact public ID case-insensitively and enriches connection status", async () => {
    const { service, prisma } = createService();
    jest.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "internal-user-a",
      publicUserId: "HT-7K4M9Q2X",
      profile: {
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
        bio: null,
        ageGroup: "26-35",
        region: "Delhi",
        primaryLanguage: "Hindi",
        languages: ["Hindi"],
      },
    } as never);
    jest.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: "connection-id",
      requesterId: "viewer-id",
      receiverId: "internal-user-a",
      status: ConnectionStatus.pending,
    } as never);

    await expect(
      service.search("viewer-id", "  ht-7k4m9q2x  "),
    ).resolves.toEqual([
      {
        id: "HT-7K4M9Q2X",
        profile: expect.objectContaining({
          username: "alice",
          ageGroup: "26-35",
        }),
        connection: {
          id: "connection-id",
          status: ConnectionStatus.pending,
          direction: "sent",
        },
      },
    ]);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publicUserId: "HT-7K4M9Q2X",
          id: { not: "viewer-id" },
          blocksMade: { none: { blockedUserId: "viewer-id" } },
          blocksReceived: { none: { blockerId: "viewer-id" } },
        }),
      }),
    );
    expect(prisma.connection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userLowId: "internal-user-a",
          userHighId: "viewer-id",
        },
      }),
    );
  });

  it("returns an empty list when no active unblocked user matches", async () => {
    const { service, prisma } = createService();
    jest.mocked(prisma.user.findFirst).mockResolvedValue(null);

    await expect(
      service.search("viewer-id", "HT-ZZZZZZZZ"),
    ).resolves.toEqual([]);
    expect(prisma.connection.findFirst).not.toHaveBeenCalled();
  });
});
