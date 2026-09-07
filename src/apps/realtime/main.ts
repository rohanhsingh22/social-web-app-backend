import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisIoAdapter } from '@app/realtime/redis-io.adapter';
import { RealtimeAppModule } from './realtime-app.module';

async function bootstrap() {
  const logger = new Logger('RealtimeBootstrap');
  const app = await NestFactory.create(RealtimeAppModule);
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.getOrThrow<string[]>('app.corsOrigins'),
    credentials: true,
  });

  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(config.getOrThrow<string>('redis.url'));
  app.useWebSocketAdapter(redisIoAdapter);

  const port = config.getOrThrow<number>('app.realtimePort');
  await app.listen(port);
  logger.log(`Realtime app listening on port ${port}`);
}

void bootstrap();
