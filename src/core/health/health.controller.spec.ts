import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('HealthController', () => {
  it('returns ok when database and redis are healthy', async () => {
    const prisma = {
      health: jest.fn().mockResolvedValue(true),
    } as unknown as PrismaService;
    const redis = {
      health: jest.fn().mockResolvedValue(true),
    } as unknown as RedisService;
    const controller = new HealthController(prisma, redis);

    await expect(controller.check()).resolves.toMatchObject({
      status: 'ok',
      database: true,
      redis: true,
    });
  });

  it('returns degraded when a dependency is unavailable', async () => {
    const prisma = {
      health: jest.fn().mockResolvedValue(true),
    } as unknown as PrismaService;
    const redis = {
      health: jest.fn().mockResolvedValue(false),
    } as unknown as RedisService;
    const controller = new HealthController(prisma, redis);

    await expect(controller.check()).resolves.toMatchObject({
      status: 'degraded',
      database: true,
      redis: false,
    });
  });
});
