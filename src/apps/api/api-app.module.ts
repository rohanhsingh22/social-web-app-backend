import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { appConfig } from '@app/config/app.config';
import { CoreModule } from '@app/core/core.module';
import { AuthModule } from '@app/modules/auth/auth.module';
import { IntegrationModule } from '@app/modules/integration/integration.module';
import { UsersModule } from '@app/modules/users/users.module';
import { ProfilesModule } from '@app/modules/profiles/profiles.module';
import { UserSettingsModule } from '@app/modules/user-settings/user-settings.module';
import { ChannelsModule } from '@app/modules/channels/channels.module';
import { ConnectionsModule } from '@app/modules/connections/connections.module';
import { DirectMessagesModule } from '@app/modules/direct-messages/direct-messages.module';
import { ThoughtsModule } from '@app/modules/thoughts/thoughts.module';
import { ToliModule } from '@app/modules/toli/toli.module';
import { ReportsModule } from '@app/modules/reports/reports.module';
import { BlocksModule } from '@app/modules/blocks/blocks.module';
import { ModerationModule } from '@app/modules/moderation/moderation.module';
import { NotificationsModule } from '@app/modules/notifications/notifications.module';
import { AdminModule } from '@app/modules/admin/admin.module';
import { UploadsModule } from '@app/modules/uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      cache: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    // Producers only: the worker app owns all consumers.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.getOrThrow<string>('redis.url'),
        },
      }),
    }),
    CoreModule,
    AuthModule,
    IntegrationModule,
    UsersModule,
    ProfilesModule,
    UserSettingsModule,
    ChannelsModule,
    ConnectionsModule,
    DirectMessagesModule,
    ThoughtsModule,
    ToliModule,
    ReportsModule,
    BlocksModule,
    ModerationModule,
    NotificationsModule,
    AdminModule,
    UploadsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class ApiAppModule {}
