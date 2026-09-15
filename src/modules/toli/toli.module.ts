import { Module } from '@nestjs/common';
import { AuthModule } from '@app/modules/auth/auth.module';
import { ToliController } from './toli.controller';
import { ToliService } from './toli.service';

@Module({
  imports: [AuthModule],
  controllers: [ToliController],
  providers: [ToliService],
  exports: [ToliService],
})
export class ToliModule {}
