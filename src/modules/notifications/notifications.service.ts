import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { NotificationType, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import {
  NOTIFICATIONS_QUEUE,
  NOTIFICATION_CREATE_JOB,
} from '@app/common/queues';
import { PrismaService } from '@app/core/prisma/prisma.service';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const DM_PREVIEW_MAX_LENGTH = 80;

export type CreateNotificationInput = {
  recipientId: string;
  type: NotificationType;
  title: string;
  body?: string;
  metadata?: Prisma.InputJsonValue;
  expiresAt?: Date;
};

export type NotificationJobData = {
  recipientId: string;
  type: NotificationType;
  title: string;
  body?: string;
  metadata?: Prisma.InputJsonValue;
};

// Single notification system for Launch 1. Only the four approved types are
// creatable through the typed helpers below; feature modules must not write
// to the notifications table directly.
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly queue?: Queue<NotificationJobData>,
  ) {}

  async create(input: CreateNotificationInput) {
    return this.prisma.notification.create({
      data: {
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        metadata: input.metadata ?? undefined,
        expiresAt: input.expiresAt,
      },
    });
  }

  async connectionRequest(
    recipientId: string,
    details: { requesterId: string; requesterName: string; connectionId: string },
  ) {
    return this.createFailOpen({
      recipientId,
      type: NotificationType.connection_request,
      title: 'New connection request',
      body: `${details.requesterName} wants to connect`,
      metadata: {
        requesterId: details.requesterId,
        connectionId: details.connectionId,
      },
    });
  }

  async connectionAccepted(
    recipientId: string,
    details: { userId: string; userName: string; conversationId?: string },
  ) {
    return this.createFailOpen({
      recipientId,
      type: NotificationType.connection_accepted,
      title: 'Connection accepted',
      body: `${details.userName} accepted your request`,
      metadata: {
        userId: details.userId,
        conversationId: details.conversationId ?? null,
      },
    });
  }

  async newDirectMessage(
    recipientId: string,
    details: {
      senderId: string;
      senderName: string;
      conversationId: string;
      messageId: string;
      preview: string;
    },
  ) {
    const preview =
      details.preview.length > DM_PREVIEW_MAX_LENGTH
        ? `${details.preview.slice(0, DM_PREVIEW_MAX_LENGTH)}…`
        : details.preview;

    return this.createFailOpen({
      recipientId,
      type: NotificationType.new_dm,
      title: 'New direct message',
      body: `${details.senderName}: ${preview}`,
      metadata: {
        senderId: details.senderId,
        conversationId: details.conversationId,
        messageId: details.messageId,
      },
    });
  }

  async legalNotice(
    recipientId: string,
    details: { title: string; body: string; adminId?: string },
  ) {
    if (!details.title.trim() || !details.body.trim()) {
      throw new BadRequestException('NOTICE_CONTENT_REQUIRED');
    }

    return this.create({
      recipientId,
      type: NotificationType.legal_notice,
      title: details.title.trim(),
      body: details.body.trim(),
      metadata: { adminId: details.adminId ?? null },
    });
  }

  async list(userId: string, cursor?: string, limitValue?: string) {
    const limit = this.parseLimit(limitValue);
    const cursorDate = cursor ? this.parseCursor(cursor) : undefined;

    const [notifications, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: {
          recipientId: userId,
          ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      this.prisma.notification.count({
        where: { recipientId: userId, readAt: null },
      }),
    ]);

    const hasMore = notifications.length > limit;
    const page = hasMore ? notifications.slice(0, limit) : notifications;

    return {
      notifications: page,
      pageInfo: {
        hasMore,
        nextCursor: hasMore
          ? page[page.length - 1]?.createdAt.toISOString() ?? null
          : null,
      },
      unreadCount,
    };
  }

  async markRead(userId: string, id: string) {
    const marked = await this.prisma.notification.updateMany({
      where: { id, recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });

    if (marked.count === 0) {
      const exists = await this.prisma.notification.findFirst({
        where: { id, recipientId: userId },
        select: { id: true },
      });

      if (!exists) {
        throw new NotFoundException('NOTIFICATION_NOT_FOUND');
      }
    }

    return { ok: true };
  }

  async markAllRead(userId: string, conversationId?: string) {
    const marked = await this.prisma.notification.updateMany({
      where: {
        recipientId: userId,
        readAt: null,
        ...(conversationId
          ? {
              metadata: {
                path: ['conversationId'],
                equals: conversationId,
              },
            }
          : {}),
      },
      data: { readAt: new Date() },
    });

    return { ok: true, marked: marked.count };
  }

  // Feature-flow helpers never break the triggering request: delivery is
  // asynchronous (worker) with a synchronous fallback, and any failure is
  // logged, not thrown. The domain write already succeeded by the time
  // these run.
  private async createFailOpen(input: CreateNotificationInput) {
    if (this.queue) {
      try {
        await this.queue.add(
          NOTIFICATION_CREATE_JOB,
          {
            recipientId: input.recipientId,
            type: input.type,
            title: input.title,
            body: input.body,
            metadata: input.metadata,
          } satisfies NotificationJobData,
          {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 1000,
          },
        );
        return null;
      } catch (error) {
        this.logger.warn(
          `Notification queue unavailable, creating directly: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    try {
      return await this.create(input);
    } catch (error) {
      this.logger.warn(
        `Notification ${input.type} to ${input.recipientId} dropped: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  private parseLimit(value?: string) {
    const limit = Number(value ?? DEFAULT_LIST_LIMIT);

    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException('INVALID_LIMIT');
    }

    return Math.min(limit, MAX_LIST_LIMIT);
  }

  private parseCursor(cursor: string) {
    const date = new Date(cursor);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('INVALID_CURSOR');
    }

    return date;
  }
}
