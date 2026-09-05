import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    const [database, redis] = await Promise.all([
      this.prisma.health(),
      this.redis.health(),
    ]);

    return {
      status: database && redis ? 'ok' : 'degraded',
      database,
      redis,
      timestamp: new Date().toISOString(),
    };
  }
}
