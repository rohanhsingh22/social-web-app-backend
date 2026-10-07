import { Module } from '@nestjs/common';
import { RateLimitService } from '@app/common/rate-limit.service';
import { AuthModule } from '@app/modules/auth/auth.module';
import { CharactersController } from './characters.controller';
import { CharactersService } from './characters.service';

@Module({
  imports: [AuthModule],
  controllers: [CharactersController],
  providers: [CharactersService, RateLimitService],
  exports: [CharactersService],
})
export class CharactersModule {}
