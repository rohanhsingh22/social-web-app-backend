import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RealtimeAppModule } from './realtime-app.module';

async function bootstrap() {
  const logger = new Logger('RealtimeBootstrap');
  const app = await NestFactory.create(RealtimeAppModule);
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.getOrThrow<string[]>('app.corsOrigins'),
    credentials: true,
  });

  const port = config.getOrThrow<number>('app.realtimePort');
  await app.listen(port);
  logger.log(`Realtime app listening on port ${port}`);
}

void bootstrap();
