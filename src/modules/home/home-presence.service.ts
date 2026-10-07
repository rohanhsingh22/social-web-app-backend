import { Injectable } from '@nestjs/common';
import { PresenceService } from '@app/realtime/presence/presence.service';

export type HomePresence = 'online' | 'offline';

/**
 * Home-facing presence (Phase 5).
 * Thin wrapper over the Redis-backed PresenceService so Home reads get
 * per-member online states in one call. Membership never lives here —
 * offline members remain members (spec Rule 7).
 */
@Injectable()
export class HomePresenceService {
  constructor(private readonly presence: PresenceService) {}

  async isOnline(userId: string): Promise<boolean> {
    return this.presence.isUserOnline(userId);
  }

  async presenceMap(userIds: string[]): Promise<Map<string, HomePresence>> {
    const entries = await Promise.all(
      userIds.map(async (userId): Promise<[string, HomePresence]> => {
        const online = await this.presence.isUserOnline(userId);
        return [userId, online ? 'online' : 'offline'];
      }),
    );
    return new Map(entries);
  }
}
