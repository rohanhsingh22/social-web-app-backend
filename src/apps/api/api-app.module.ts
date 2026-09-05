import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { appConfig } from '@app/config/app.config';
import { CoreModule } from '@app/core/core.module';
import { AuthModule } from '@app/modules/auth/auth.module';
import { UsersModule } from '@app/modules/users/users.module';
import { ProfilesModule } from '@app/modules/profiles/profiles.module';
import { ChannelsModule } from '@app/modules/channels/channels.module';
import { ConnectionsModule } from '@app/modules/connections/connections.module';
import { DirectMessagesModule } from '@app/modules/direct-messages/direct-messages.module';
import { ReportsModule } from '@app/modules/reports/reports.module';
import { BlocksModule } from '@app/modules/blocks/blocks.module';
import { ModerationModule } from '@app/modules/moderation/moderation.module';
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
    CoreModule,
    AuthModule,
    UsersModule,
    ProfilesModule,
    ChannelsModule,
    ConnectionsModule,
    DirectMessagesModule,
    ReportsModule,
    BlocksModule,
    ModerationModule,
    AdminModule,
    UploadsModule,
  ],
})
export class ApiAppModule {}
