import { Module } from "@nestjs/common";
import { RateLimitService } from "@app/common/rate-limit.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, RateLimitService],
})
export class UsersModule {}
