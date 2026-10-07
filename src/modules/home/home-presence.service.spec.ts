import { PresenceService } from '@app/realtime/presence/presence.service';
import { HomePresenceService } from './home-presence.service';

describe('HomePresenceService', () => {
  const createService = () => {
    const presence = {
      isUserOnline: jest.fn(),
    } as unknown as PresenceService;
    return {
      service: new HomePresenceService(presence),
      presence,
    };
  };

  it('delegates single-user checks', async () => {
    const { service, presence } = createService();
    (presence.isUserOnline as jest.Mock).mockResolvedValue(true);

    await expect(service.isOnline('user-1')).resolves.toBe(true);
    expect(presence.isUserOnline).toHaveBeenCalledWith('user-1');
  });

  it('maps many users to online/offline states', async () => {
    const { service, presence } = createService();
    (presence.isUserOnline as jest.Mock).mockImplementation(
      (userId: string) => Promise.resolve(userId === 'user-1'),
    );

    const map = await service.presenceMap(['user-1', 'user-2']);

    expect(map.get('user-1')).toBe('online');
    expect(map.get('user-2')).toBe('offline');
  });
});
