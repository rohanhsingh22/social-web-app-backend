import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { envelope } from "@app/common/api-response";
import { AuthGuard } from "@app/modules/auth/auth.guard";
import { CurrentUser } from "@app/modules/auth/current-user.decorator";
import { AuthenticatedUser } from "@app/modules/auth/auth.types";
import { ConnectionsService } from "./connections.service";
import { CreateConnectionRequestDto } from "./dto/create-connection-request.dto";

@Controller("connections")
@UseGuards(AuthGuard)
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return envelope({
      connections: await this.connectionsService.list(user.id),
    });
  }

  @Get("requests/received")
  async received(@CurrentUser() user: AuthenticatedUser) {
    return envelope({
      requests: await this.connectionsService.received(user.id),
    });
  }

  @Get("requests/sent")
  async sent(@CurrentUser() user: AuthenticatedUser) {
    return envelope({
      requests: await this.connectionsService.sent(user.id),
    });
  }

  @Post("requests")
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateConnectionRequestDto,
  ) {
    return envelope({
      request: await this.connectionsService.createRequest(
        user.id,
        body.receiverUserId,
      ),
    });
  }

  @Post("requests/:id/accept")
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return envelope(await this.connectionsService.accept(user.id, id));
  }

  @Post("requests/:id/reject")
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return envelope({
      request: await this.connectionsService.reject(user.id, id),
    });
  }

  @Post("requests/:id/cancel")
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return envelope({
      request: await this.connectionsService.cancel(user.id, id),
    });
  }

  @Delete(":connectionId")
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("connectionId") connectionId: string,
  ) {
    return envelope({
      connection: await this.connectionsService.remove(user.id, connectionId),
    });
  }
}
