import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { initSentry } from '@app/common/sentry';
import { WorkerAppModule } from './worker-app.module';

async function bootstrap() {
  initSentry('worker');
  const logger = new Logger('WorkerBootstrap');
  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  app.enableShutdownHooks();
  logger.log('Worker app context started');
}

void bootstrap();
