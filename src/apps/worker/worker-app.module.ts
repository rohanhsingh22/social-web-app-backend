import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { appConfig } from '@app/config/app.config';
import { CoreModule } from '@app/core/core.module';
import { ModerationWorkerModule } from '@app/workers/moderation-worker/moderation-worker.module';
import { NotificationWorkerModule } from '@app/workers/notification-worker/notification-worker.module';
import { ThoughtEventsWorkerModule } from '@app/workers/thought-events-worker/thought-events-worker.module';
import { CleanupWorkerModule } from '@app/workers/cleanup-worker/cleanup-worker.module';
import { ImageWorkerModule } from '@app/workers/image-worker/image-worker.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      cache: true,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.getOrThrow<string>('redis.url'),
        },
      }),
    }),
    CoreModule,
    ModerationWorkerModule,
    NotificationWorkerModule,
    ThoughtEventsWorkerModule,
    CleanupWorkerModule,
    ImageWorkerModule,
  ],
})
export class WorkerAppModule {}
