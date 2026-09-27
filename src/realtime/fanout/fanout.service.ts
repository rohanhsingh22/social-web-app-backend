import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@app/core/redis/redis.service';

// Cross-process realtime bridge. The API app (REST mutations) and the
// realtime app (sockets) are separate processes: mutations publish here,
// the notifications gateway subscribes and emits into per-user rooms.
export const REALTIME_FANOUT_CHANNEL = 'realtime:fanout';

export type FanoutUserEvent =
  | { event: 'connection:changed'; userIds: string[] }
  | { event: 'notification:new'; userIds: string[] }
  | { event: 'toli:changed'; userIds: string[] };

@Injectable()
export class FanoutService {
  private readonly logger = new Logger(FanoutService.name);

  constructor(private readonly redis: RedisService) {}

  // Fire-and-forget by design: callers `void` this. A Redis outage must
  // never fail the mutation; clients still converge via polling.
  async publishUserEvent(
    userIds: Array<string | null | undefined>,
    event: FanoutUserEvent['event'],
  ): Promise<void> {
    const unique = [...new Set(userIds.filter((id): id is string => Boolean(id)))];

    if (unique.length === 0) {
      return;
    }

    try {
      const payload: FanoutUserEvent = { event, userIds: unique } as FanoutUserEvent;
      await this.redis.connection.publish(
        REALTIME_FANOUT_CHANNEL,
        JSON.stringify(payload),
      );
    } catch (error) {
      this.logger.debug(
        `Fanout publish failed for ${event}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
