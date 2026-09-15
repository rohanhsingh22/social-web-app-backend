import { NotificationType } from '@prisma/client';
import { Job } from 'bullmq';
import { NotificationsService } from '@app/modules/notifications/notifications.service';
import { NotificationProcessor } from './notification.processor';

describe('NotificationProcessor', () => {
  const createProcessor = () => {
    const notifications = {
      create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
    } as unknown as NotificationsService;

    return {
      processor: new NotificationProcessor(notifications),
      notifications,
    };
  };

  const job = (overrides = {}) =>
    ({
      id: 'job-1',
      name: 'NOTIFICATION_CREATE',
      data: {
        recipientId: 'user-b',
        type: NotificationType.connection_request,
        title: 'New connection request',
        body: 'Alice wants to connect',
      },
      ...overrides,
    }) as Job;

  it('persists queued notifications through the central service', async () => {
    const { processor, notifications } = createProcessor();

    await expect(processor.process(job())).resolves.toEqual({
      id: 'notification-1',
    });
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'user-b',
        type: NotificationType.connection_request,
      }),
    );
  });

  it('ignores unknown job names without writing', async () => {
    const { processor, notifications } = createProcessor();

    await expect(
      processor.process(job({ name: 'SOMETHING_ELSE' })),
    ).resolves.toBeNull();
    expect(notifications.create).not.toHaveBeenCalled();
  });
});
