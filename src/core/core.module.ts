import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { SessionService } from './session/session.service';
import { RequestLoggingMiddleware } from './logging/request-logging.middleware';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [HealthController],
  providers: [PrismaService, RedisService, SessionService],
  exports: [PrismaService, RedisService, SessionService],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
