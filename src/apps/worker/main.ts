import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerAppModule } from './worker-app.module';

async function bootstrap() {
  const logger = new Logger('WorkerBootstrap');
  await NestFactory.createApplicationContext(WorkerAppModule);
  logger.log('Worker app context started');
}

void bootstrap();
