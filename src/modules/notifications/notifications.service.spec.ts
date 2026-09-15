import { NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const createService = (withQueue = false) => {
    const notification = {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    };
    const prisma = { notification } as unknown as PrismaService;
    const queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    return {
      service: new NotificationsService(
        prisma,
        withQueue ? (queue as never) : undefined,
      ),
      notification,
      queue,
    };
  };

  it('creates only the approved notification types', async () => {
    const { service, notification } = createService();
    notification.create.mockResolvedValue({ id: 'notification-1' });

    await service.connectionRequest('user-b', {
      requesterId: 'user-a',
      requesterName: 'Alice',
      connectionId: 'connection-1',
    });
    await service.connectionAccepted('user-a', {
      userId: 'user-b',
      userName: 'Bob',
      conversationId: 'conversation-1',
    });
    await service.newDirectMessage('user-b', {
      senderId: 'user-a',
      senderName: 'Alice',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      preview: 'hello there',
    });

    const types = notification.create.mock.calls.map(
      (call) => call[0].data.type,
    );
    expect(types).toEqual([
      NotificationType.connection_request,
      NotificationType.connection_accepted,
      NotificationType.new_dm,
    ]);
    expect(types).not.toContain('thought_like');
  });

  it('truncates long DM previews', async () => {
    const { service, notification } = createService();
    notification.create.mockResolvedValue({ id: 'notification-1' });

    await service.newDirectMessage('user-b', {
      senderId: 'user-a',
      senderName: 'Alice',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      preview: 'x'.repeat(200),
    });

    const body = notification.create.mock.calls[0][0].data.body as string;
    expect(body.startsWith('Alice: ')).toBe(true);
    expect(body.length).toBeLessThanOrEqual('Alice: '.length + 81);
  });

  it('lists newest-first with unread counts and cursors', async () => {
    const { service, notification } = createService();
    notification.findMany.mockResolvedValue([
      { id: 'n2', createdAt: new Date('2026-09-14T11:00:00.000Z') },
      { id: 'n1', createdAt: new Date('2026-09-14T10:00:00.000Z') },
    ]);
    notification.count.mockResolvedValue(2);

    const page = await service.list('user-1', undefined, '1');

    expect(notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 }),
    );
    expect(page).toEqual({
      notifications: [
        { id: 'n2', createdAt: new Date('2026-09-14T11:00:00.000Z') },
      ],
      pageInfo: { hasMore: true, nextCursor: '2026-09-14T11:00:00.000Z' },
      unreadCount: 2,
    });
  });

  it('rejects reads of foreign notifications', async () => {
    const { service, notification } = createService();
    notification.updateMany.mockResolvedValue({ count: 0 });
    notification.findFirst.mockResolvedValue(null);

    await expect(service.markRead('user-1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('marks conversation notifications read without touching others', async () => {
    const { service, notification } = createService();
    notification.updateMany.mockResolvedValue({ count: 2 });

    await expect(
      service.markAllRead('user-1', 'conversation-1'),
    ).resolves.toEqual({ ok: true, marked: 2 });
    expect(notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recipientId: 'user-1',
          readAt: null,
          metadata: { path: ['conversationId'], equals: 'conversation-1' },
        }),
      }),
    );
  });

  it('enqueues delivery jobs with retries instead of inline writes', async () => {
    const { service, notification, queue } = createService(true);
    notification.create.mockResolvedValue({ id: 'notification-1' });

    await service.connectionRequest('user-b', {
      requesterId: 'user-a',
      requesterName: 'Alice',
      connectionId: 'connection-1',
    });

    expect(queue.add).toHaveBeenCalledWith(
      'NOTIFICATION_CREATE',
      expect.objectContaining({
        recipientId: 'user-b',
        type: 'connection_request',
      }),
      expect.objectContaining({
        attempts: 5,
        backoff: expect.objectContaining({ type: 'exponential' }),
      }),
    );
    expect(notification.create).not.toHaveBeenCalled();
  });

  it('falls back to direct writes when the queue is down', async () => {
    const { service, notification, queue } = createService(true);
    queue.add.mockRejectedValue(new Error('redis down'));
    notification.create.mockResolvedValue({ id: 'notification-1' });

    await service.newDirectMessage('user-b', {
      senderId: 'user-a',
      senderName: 'Alice',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      preview: 'hello',
    });

    expect(notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recipientId: 'user-b' }),
      }),
    );
  });

  it('keeps legal notices synchronous for auditability', async () => {
    const { service, notification, queue } = createService(true);
    notification.create.mockResolvedValue({ id: 'notification-1' });

    await service.legalNotice('user-1', {
      title: 'Terms update',
      body: 'Please review.',
      adminId: 'admin-1',
    });

    expect(queue.add).not.toHaveBeenCalled();
    expect(notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'legal_notice' }),
      }),
    );
  });
});
