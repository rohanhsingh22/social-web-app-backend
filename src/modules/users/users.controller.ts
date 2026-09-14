import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { envelope } from "@app/common/api-response";
import { AuthGuard } from "@app/modules/auth/auth.guard";
import { CurrentUser } from "@app/modules/auth/current-user.decorator";
import { AuthenticatedUser } from "@app/modules/auth/auth.types";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("search")
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Query("q") query = "",
  ) {
    return envelope({
      query,
      users: await this.usersService.search(user.id, query),
    });
  }
}
