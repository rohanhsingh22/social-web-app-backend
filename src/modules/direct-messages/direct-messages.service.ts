import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ConnectionStatus,
  MessageStatus,
  Prisma,
  UserStatus,
} from "@prisma/client";
import { PrismaService } from "@app/core/prisma/prisma.service";
import { ModerationService } from "@app/modules/moderation/moderation.service";

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const DIRECT_MESSAGE_MAX_LENGTH = 1000;

type ConversationWithMembers = Prisma.ConversationGetPayload<{
  include: {
    members: {
      include: {
        user: {
          select: {
            id: true;
            profile: {
              select: ReturnType<DirectMessagesService["publicProfileSelect"]>;
            };
          };
        };
      };
    };
  };
}>;

type DirectMessageWithSender = Prisma.DirectMessageGetPayload<{
  include: {
    sender: {
      select: {
        id: true;
        profile: {
          select: ReturnType<DirectMessagesService["senderProfileSelect"]>;
        };
      };
    };
  };
}>;

@Injectable()
export class DirectMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
  ) {}

  async listConversations(userId: string) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId },
      orderBy: { conversation: { updatedAt: "desc" } },
      include: {
        conversation: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    profile: { select: this.publicProfileSelect() },
                  },
                },
              },
            },
            messages: {
              where: { status: MessageStatus.active },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              include: {
                sender: {
                  select: {
                    id: true,
                    profile: { select: this.senderProfileSelect() },
                  },
                },
              },
            },
          },
        },
      },
    });

    return memberships.map((membership) => ({
      ...this.mapConversation(membership.conversation, userId),
      latestMessage: membership.conversation.messages[0]
        ? this.mapMessage(membership.conversation.messages[0])
        : null,
    }));
  }

  async getMessages(
    userId: string,
    conversationId: string,
    cursor?: string,
    limitValue?: string,
  ) {
    const conversation = await this.getConversationForUser(
      userId,
      conversationId,
    );
    await this.assertDirectConversationAccess(conversation, userId);

    const limit = this.parseLimit(limitValue);
    const messages = await this.prisma.directMessage.findMany({
      where: {
        conversationId,
        status: MessageStatus.active,
        ...(cursor
          ? {
              createdAt: {
                lt: this.parseCursor(cursor),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        sender: {
          select: {
            id: true,
            profile: { select: this.senderProfileSelect() },
          },
        },
      },
    });

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore
      ? page[page.length - 1]?.createdAt.toISOString()
      : null;

    return {
      conversation: this.mapConversation(conversation, userId),
      messages: page.reverse().map((message) => this.mapMessage(message)),
      pageInfo: {
        hasMore,
        nextCursor,
      },
    };
  }

  async createMessage(userId: string, conversationId: string, body: string) {
    const bodyText = this.normalizeBody(body);
    const conversation = await this.getConversationForUser(
      userId,
      conversationId,
    );
    await this.assertDirectConversationAccess(conversation, userId, {
      requireSenderCanMessage: true,
    });
    await this.moderation.assertMessageAllowed(bodyText);

    const message = await this.prisma.directMessage.create({
      data: {
        conversationId,
        senderId: userId,
        body: bodyText,
      },
      include: {
        sender: {
          select: {
            id: true,
            profile: { select: this.senderProfileSelect() },
          },
        },
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
      select: { id: true },
    });

    return {
      message: this.mapMessage(message),
      recipientUserIds: conversation.members
        .map((member) => member.userId)
        .filter((memberUserId) => memberUserId !== userId),
    };
  }

  async getConversationForUser(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                profile: { select: this.publicProfileSelect() },
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException("CONVERSATION_NOT_FOUND");
    }

    if (!conversation.members.some((member) => member.userId === userId)) {
      throw new ForbiddenException("CONVERSATION_ACCESS_DENIED");
    }

    return conversation;
  }

  normalizeBody(body: string) {
    const bodyText = body.trim().replace(/\s+/g, " ");

    if (!bodyText) {
      throw new BadRequestException("MESSAGE_REQUIRED");
    }

    if (bodyText.length > DIRECT_MESSAGE_MAX_LENGTH) {
      throw new BadRequestException("MESSAGE_TOO_LONG");
    }

    return bodyText;
  }

  private async assertDirectConversationAccess(
    conversation: ConversationWithMembers,
    userId: string,
    options: { requireSenderCanMessage?: boolean } = {},
  ) {
    if (conversation.type !== "direct" || conversation.members.length !== 2) {
      throw new ForbiddenException("DIRECT_CONVERSATION_REQUIRED");
    }

    const sender = conversation.members.find(
      (member) => member.userId === userId,
    );
    const recipient = conversation.members.find(
      (member) => member.userId !== userId,
    );

    if (!sender || !recipient) {
      throw new ForbiddenException("CONVERSATION_ACCESS_DENIED");
    }

    const [senderUser, block, connection] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, status: true },
      }),
      this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: userId, blockedUserId: recipient.userId },
            { blockerId: recipient.userId, blockedUserId: userId },
          ],
        },
        select: { id: true },
      }),
      this.prisma.connection.findUnique({
        where: {
          userLowId_userHighId: this.normalizedPair(userId, recipient.userId),
        },
        select: { id: true, status: true },
      }),
    ]);

    if (!senderUser || senderUser.status === UserStatus.banned) {
      throw new ForbiddenException("USER_BANNED");
    }

    if (
      options.requireSenderCanMessage &&
      senderUser.status === UserStatus.muted
    ) {
      throw new ForbiddenException("USER_MUTED");
    }

    if (block) {
      throw new ForbiddenException("BLOCKED");
    }

    if (connection?.status !== ConnectionStatus.accepted) {
      throw new ForbiddenException("CONNECTION_REQUIRED");
    }
  }

  private parseLimit(value?: string) {
    const limit = Number(value ?? DEFAULT_MESSAGE_LIMIT);

    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException("INVALID_LIMIT");
    }

    return Math.min(limit, MAX_MESSAGE_LIMIT);
  }

  private parseCursor(cursor: string) {
    const date = new Date(cursor);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("INVALID_CURSOR");
    }

    return date;
  }

  private normalizedPair(firstUserId: string, secondUserId: string) {
    const [userLowId, userHighId] = [firstUserId, secondUserId].sort();
    return { userLowId, userHighId };
  }

  private mapConversation(
    conversation: ConversationWithMembers,
    viewerId: string,
  ) {
    return {
      id: conversation.id,
      type: conversation.type,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      members: conversation.members.map((member) => ({
        userId: member.userId,
        isSelf: member.userId === viewerId,
        profile: member.user.profile,
      })),
    };
  }

  private mapMessage(message: DirectMessageWithSender) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      body: message.body,
      status: message.status,
      createdAt: message.createdAt,
      sender: {
        id: message.sender.id,
        profile: message.sender.profile,
      },
    };
  }

  private publicProfileSelect() {
    return {
      userId: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      ageGroup: true,
      region: true,
      primaryLanguage: true,
      languages: true,
    } satisfies Prisma.ProfileSelect;
  }

  private senderProfileSelect() {
    return {
      username: true,
      displayName: true,
      avatarUrl: true,
    } satisfies Prisma.ProfileSelect;
  }
}
