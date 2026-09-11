import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { envelope } from "@app/common/api-response";
import { AuthGuard } from "@app/modules/auth/auth.guard";
import { CurrentUser } from "@app/modules/auth/current-user.decorator";
import { AuthenticatedUser } from "@app/modules/auth/auth.types";
import { DirectMessagesService } from "./direct-messages.service";

@Controller("dm")
@UseGuards(AuthGuard)
export class DirectMessagesController {
  constructor(private readonly directMessages: DirectMessagesService) {}

  @Get("conversations")
  async conversations(@CurrentUser() user: AuthenticatedUser) {
    return envelope({
      conversations: await this.directMessages.listConversations(user.id),
    });
  }

  @Get("conversations/:id/messages")
  async messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit = "50",
  ) {
    return envelope(
      await this.directMessages.getMessages(user.id, id, cursor, limit),
    );
  }
}
