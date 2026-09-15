import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from '@app/common/all-exceptions.filter';
import { ChannelsService } from '@app/modules/channels/channels.service';
import { ApiAppModule } from './api-app.module';
import type { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const logger = new Logger('ApiBootstrap');
  const app = await NestFactory.create(ApiAppModule);
  const config = app.get(ConfigService);
  const corsOrigins = config.getOrThrow<string[]>('app.corsOrigins');

  app.use(helmet());
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.log(`${req.method} ${req.url} - ${ms.toFixed(2)}ms`);
    });
    next();
  });
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
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableShutdownHooks();
  await app.init();

  try {
    await app.get(ChannelsService).warmDefaultMessageCache();
    logger.log('Default channel message cache warmed');
  } catch (error) {
    logger.warn(
      `Default channel cache warmup skipped: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }

  const port = config.getOrThrow<number>('app.port');
  await app.listen(port);
  logger.log(`API app listening on port ${port}`);
}

void bootstrap();
