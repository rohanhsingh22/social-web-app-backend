import { BadRequestException } from "@nestjs/common";
import { ConnectionStatus } from "@prisma/client";
import { RateLimitService } from "@app/common/rate-limit.service";
import { PrismaService } from "@app/core/prisma/prisma.service";
import { UsersService } from "./users.service";

describe("UsersService", () => {
  const createService = () => {
    const prisma = {
      profile: {
        findMany: jest.fn(),
      },
      connection: {
        findMany: jest.fn(),
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

  it("returns no results for short queries but still rate limits enumeration", async () => {
    const { service, prisma, rateLimit } = createService();

    await expect(service.search("viewer-id", "a")).resolves.toEqual([]);
    expect(rateLimit.assertAllowed).toHaveBeenCalledWith(
      "ratelimit:users:search:viewer-id",
      60,
      60,
    );
    expect(prisma.profile.findMany).not.toHaveBeenCalled();
  });

  it("searches safe profile fields and adds viewer-relative connection status", async () => {
    const { service, prisma } = createService();
    jest.mocked(prisma.profile.findMany).mockResolvedValue([
      {
        userId: "user-a",
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
        bio: null,
        ageGroup: "26-35",
        region: "Delhi",
        primaryLanguage: "Hindi",
        languages: ["Hindi"],
      },
    ] as never);
    jest.mocked(prisma.connection.findMany).mockResolvedValue([
      {
        id: "connection-id",
        requesterId: "viewer-id",
        receiverId: "user-a",
        status: ConnectionStatus.pending,
      },
    ] as never);

    await expect(service.search("viewer-id", "ali", "5")).resolves.toEqual([
      {
        id: "user-a",
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
    expect(prisma.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: { not: "viewer-id" },
          user: expect.objectContaining({
            blocksMade: { none: { blockedUserId: "viewer-id" } },
            blocksReceived: { none: { blockerId: "viewer-id" } },
          }),
        }),
        take: 5,
      }),
    );
  });

  it("rejects invalid limits", async () => {
    const { service } = createService();

    await expect(service.search("viewer-id", "alice", "zero")).rejects.toThrow(
      BadRequestException,
    );
  });
});
