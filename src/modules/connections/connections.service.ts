import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  Connection,
  ConnectionStatus,
  Prisma,
  UserStatus,
} from "@prisma/client";
import { RateLimitService } from "@app/common/rate-limit.service";
import { normalizePublicUserId } from "@app/common/public-user-id";
import { profileCardSelect } from "@app/common/profile-card";
import { PrismaService } from "@app/core/prisma/prisma.service";
import { NotificationsService } from "@app/modules/notifications/notifications.service";
import { ThoughtsService } from "@app/modules/thoughts/thoughts.service";

const CONNECTION_REQUEST_DAILY_LIMIT = 30;
const DAY_SECONDS = 24 * 60 * 60;

type PublicUser = {
  id: string;
  status: UserStatus;
  profile: PublicProfile | null;
};

type PublicProfile = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  ageGroup: string | null;
  region: string | null;
  primaryLanguage: string | null;
  languages: string[];
};

type ConnectionWithProfiles = Connection & {
  requester: PublicUser;
  receiver: PublicUser;
};

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly notifications: NotificationsService,
    private readonly thoughts: ThoughtsService,
  ) {}

  async list(userId: string) {
    const connections = await this.prisma.connection.findMany({
      where: {
        status: ConnectionStatus.accepted,
        OR: [{ requesterId: userId }, { receiverId: userId }],
      },
      orderBy: { updatedAt: "desc" },
      include: this.connectionInclude(),
    });

    return connections.map((connection) =>
      this.mapConnection(connection, userId),
    );
  }

  async received(userId: string) {
    const requests = await this.prisma.connection.findMany({
      where: {
        receiverId: userId,
        status: ConnectionStatus.pending,
      },
      orderBy: { createdAt: "desc" },
      include: this.connectionInclude(),
    });

    return requests.map((connection) => this.mapConnection(connection, userId));
  }

  async sent(userId: string) {
    const requests = await this.prisma.connection.findMany({
      where: {
        requesterId: userId,
        status: ConnectionStatus.pending,
      },
      orderBy: { createdAt: "desc" },
      include: this.connectionInclude(),
    });

    return requests.map((connection) => this.mapConnection(connection, userId));
  }

  async createRequest(requesterId: string, receiverPublicUserId: string) {
    const publicUserId = normalizePublicUserId(receiverPublicUserId);

    if (!publicUserId) {
      throw new NotFoundException("USER_NOT_FOUND");
    }

    await this.rateLimit.assertAllowed(
      `ratelimit:connections:requests:${requesterId}`,
      CONNECTION_REQUEST_DAILY_LIMIT,
      DAY_SECONDS,
    );

    const [requester, receiver] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: requesterId },
        select: { id: true, status: true },
      }),
      this.prisma.user.findUnique({
        where: { publicUserId },
        select: { id: true, status: true },
      }),
    ]);

    if (!requester || requester.status !== UserStatus.active) {
      throw new ForbiddenException("ACCOUNT_NOT_ALLOWED");
    }

    if (!receiver || receiver.status === UserStatus.deleted) {
      throw new NotFoundException("USER_NOT_FOUND");
    }

    if (requester.id === receiver.id) {
      throw new BadRequestException("CANNOT_CONNECT_TO_SELF");
    }

    if (receiver.status === UserStatus.banned) {
      throw new ForbiddenException("USER_NOT_AVAILABLE");
    }

    const receiverId = receiver.id;

    await this.assertNotBlocked(requesterId, receiverId);

    const { userLowId, userHighId } = this.normalizedPair(
      requesterId,
      receiverId,
    );
    const existing = await this.prisma.connection.findUnique({
      where: {
        userLowId_userHighId: {
          userLowId,
          userHighId,
        },
      },
      include: this.connectionInclude(),
    });

    if (existing?.status === ConnectionStatus.pending) {
      throw new ConflictException("CONNECTION_REQUEST_EXISTS");
    }

    if (existing?.status === ConnectionStatus.accepted) {
      throw new ConflictException("CONNECTION_ALREADY_ACCEPTED");
    }

    const request = existing
      ? await this.prisma.connection.update({
          where: { id: existing.id },
          data: {
            requesterId,
            receiverId,
            status: ConnectionStatus.pending,
          },
          include: this.connectionInclude(),
        })
      : await this.prisma.connection.create({
          data: {
            requesterId,
            receiverId,
            userLowId,
            userHighId,
            status: ConnectionStatus.pending,
          },
          include: this.connectionInclude(),
        });

    this.logger.log(
      `Connection request ${request.id} created by ${requesterId}`,
    );

    const requesterName = await this.displayNameOf(requesterId);
    await this.notifications.connectionRequest(receiverId, {
      requesterId,
      requesterName,
      connectionId: request.id,
    });
    await this.thoughts.recordEvent(requesterId, 'connection_request', undefined, {
      targetUserId: receiverId,
    });

    return this.mapConnection(request, requesterId);
  }

  async accept(userId: string, connectionId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const connection = await this.getPendingForReceiver(
        tx,
        connectionId,
        userId,
      );

      await this.assertNotBlocked(
        connection.requesterId,
        connection.receiverId,
        tx,
      );
      await this.assertUsersActive(
        tx,
        connection.requesterId,
        connection.receiverId,
      );

      const accepted = await tx.connection.update({
        where: { id: connection.id },
        data: { status: ConnectionStatus.accepted },
        include: this.connectionInclude(),
      });

      const conversation = await this.findOrCreateDirectConversation(
        tx,
        connection.requesterId,
        connection.receiverId,
      );

      this.logger.log(
        `Connection request ${connectionId} accepted by ${userId}`,
      );
      return {
        connection: this.mapConnection(accepted, userId),
        conversation,
      };
    });

    const userName = await this.displayNameOf(userId);
    await this.notifications.connectionAccepted(
      result.connection.requesterId,
      {
        userId,
        userName,
        conversationId: result.conversation.id,
      },
    );

    return result;
  }

  async reject(userId: string, connectionId: string) {
    const connection = await this.getConnectionOrThrow(connectionId);

    if (
      connection.receiverId !== userId ||
      connection.status !== ConnectionStatus.pending
    ) {
      throw new ForbiddenException("CONNECTION_ACTION_NOT_ALLOWED");
    }

    const rejected = await this.prisma.connection.update({
      where: { id: connection.id },
      data: { status: ConnectionStatus.rejected },
      include: this.connectionInclude(),
    });

    return this.mapConnection(rejected, userId);
  }

  async cancel(userId: string, connectionId: string) {
    const connection = await this.getConnectionOrThrow(connectionId);

    if (
      connection.requesterId !== userId ||
      connection.status !== ConnectionStatus.pending
    ) {
      throw new ForbiddenException("CONNECTION_ACTION_NOT_ALLOWED");
    }

    const cancelled = await this.prisma.connection.update({
      where: { id: connection.id },
      data: { status: ConnectionStatus.cancelled },
      include: this.connectionInclude(),
    });

    return this.mapConnection(cancelled, userId);
  }

  async remove(userId: string, connectionId: string) {
    const connection = await this.getConnectionOrThrow(connectionId);

    if (
      connection.status !== ConnectionStatus.accepted ||
      (connection.requesterId !== userId && connection.receiverId !== userId)
    ) {
      throw new ForbiddenException("CONNECTION_ACTION_NOT_ALLOWED");
    }

    const removed = await this.prisma.connection.update({
      where: { id: connection.id },
      data: { status: ConnectionStatus.cancelled },
      include: this.connectionInclude(),
    });

    return this.mapConnection(removed, userId);
  }

  private async getConnectionOrThrow(connectionId: string) {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundException("CONNECTION_NOT_FOUND");
    }

    return connection;
  }

  private async getPendingForReceiver(
    tx: Prisma.TransactionClient,
    connectionId: string,
    userId: string,
  ) {
    const connection = await tx.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new NotFoundException("CONNECTION_NOT_FOUND");
    }

    if (
      connection.receiverId !== userId ||
      connection.status !== ConnectionStatus.pending
    ) {
      throw new ForbiddenException("CONNECTION_ACTION_NOT_ALLOWED");
    }

    return connection;
  }

  private async assertUsersActive(
    tx: Prisma.TransactionClient,
    firstUserId: string,
    secondUserId: string,
  ) {
    const users = await tx.user.findMany({
      where: { id: { in: [firstUserId, secondUserId] } },
      select: { id: true, status: true },
    });

    if (
      users.length !== 2 ||
      users.some((user) => user.status !== UserStatus.active)
    ) {
      throw new ForbiddenException("ACCOUNT_NOT_ALLOWED");
    }
  }

  private async assertNotBlocked(
    firstUserId: string,
    secondUserId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const block = await tx.block.findFirst({
      where: {
        OR: [
          { blockerId: firstUserId, blockedUserId: secondUserId },
          { blockerId: secondUserId, blockedUserId: firstUserId },
        ],
      },
      select: { id: true },
    });

    if (block) {
      throw new ForbiddenException("BLOCKED");
    }
  }

  private async findOrCreateDirectConversation(
    tx: Prisma.TransactionClient,
    firstUserId: string,
    secondUserId: string,
  ) {
    const existing = await tx.conversation.findFirst({
      where: {
        type: "direct",
        AND: [
          { members: { some: { userId: firstUserId } } },
          { members: { some: { userId: secondUserId } } },
        ],
      },
      select: { id: true, type: true, createdAt: true, updatedAt: true },
    });

    if (existing) {
      return existing;
    }

    return tx.conversation.create({
      data: {
        type: "direct",
        members: {
          create: [{ userId: firstUserId }, { userId: secondUserId }],
        },
      },
      select: { id: true, type: true, createdAt: true, updatedAt: true },
    });
  }

  private normalizedPair(firstUserId: string, secondUserId: string) {
    const [userLowId, userHighId] = [firstUserId, secondUserId].sort();
    return { userLowId, userHighId };
  }

  private async displayNameOf(userId: string): Promise<string> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { displayName: true },
    });

    return profile?.displayName ?? 'Someone';
  }

  private connectionInclude() {
    return {
      requester: {
        select: {
          id: true,
          status: true,
          profile: { select: this.publicProfileSelect() },
        },
      },
      receiver: {
        select: {
          id: true,
          status: true,
          profile: { select: this.publicProfileSelect() },
        },
      },
    } satisfies Prisma.ConnectionInclude;
  }

  private publicProfileSelect() {
    return {
      userId: true,
      ...profileCardSelect,
      bio: true,
      ageGroup: true,
      region: true,
      primaryLanguage: true,
      languages: true,
    } satisfies Prisma.ProfileSelect;
  }

  private mapConnection(connection: ConnectionWithProfiles, viewerId: string) {
    const otherUser =
      connection.requesterId === viewerId
        ? connection.receiver
        : connection.requester;

    return {
      id: connection.id,
      status: connection.status,
      requesterId: connection.requesterId,
      receiverId: connection.receiverId,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      otherUser: this.mapPublicUser(otherUser),
    };
  }

  private mapPublicUser(user: PublicUser) {
    return {
      id: user.id,
      profile: user.profile,
    };
  }
}
