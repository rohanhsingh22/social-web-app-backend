import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { RequestLoggingMiddleware } from './logging/request-logging.middleware';

@Global()
@Module({
  controllers: [HealthController],
  providers: [PrismaService, RedisService],
  exports: [PrismaService, RedisService],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
