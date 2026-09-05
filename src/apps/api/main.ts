import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiAppModule } from './api-app.module';

async function bootstrap() {
  const logger = new Logger('ApiBootstrap');
  const app = await NestFactory.create(ApiAppModule);
  const config = app.get(ConfigService);
  const corsOrigins = config.getOrThrow<string[]>('app.corsOrigins');

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = config.getOrThrow<number>('app.port');
  await app.listen(port);
  logger.log(`API app listening on port ${port}`);
}

void bootstrap();
