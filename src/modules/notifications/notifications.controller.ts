import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { envelope } from '@app/common/api-response';
import { AuthGuard } from '@app/modules/auth/auth.guard';
import { AuthenticatedUser } from '@app/modules/auth/auth.types';
import { CurrentUser } from '@app/modules/auth/current-user.decorator';
import { MarkAllReadDto } from './dto/mark-all-read.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return envelope(
      await this.notificationsService.list(user.id, cursor, limit),
    );
  }

  @Post('read')
  async markAllRead(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: MarkAllReadDto,
  ) {
    return envelope(
      await this.notificationsService.markAllRead(
        user.id,
        body.conversationId,
      ),
    );
  }

  @Post(':id/read')
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return envelope(await this.notificationsService.markRead(user.id, id));
  }
}
