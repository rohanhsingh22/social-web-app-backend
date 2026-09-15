import { Module } from '@nestjs/common';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { AuthModule } from '../auth/auth.module';
import { ThoughtsModule } from '../thoughts/thoughts.module';
import { ToliModule } from '../toli/toli.module';

@Module({
  imports: [AuthModule, ThoughtsModule, ToliModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}
