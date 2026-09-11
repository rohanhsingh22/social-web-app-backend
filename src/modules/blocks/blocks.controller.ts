import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { envelope } from '@app/common/api-response';
import { AuthGuard } from '@app/modules/auth/auth.guard';
import { CurrentUser } from '@app/modules/auth/current-user.decorator';
import { AuthenticatedUser } from '@app/modules/auth/auth.types';
import { BlocksService } from './blocks.service';
import { CreateBlockDto } from './dto/create-block.dto';

@Controller('blocks')
@UseGuards(AuthGuard)
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return envelope({ blocks: await this.blocksService.list(user.id) });
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateBlockDto,
  ) {
    return envelope({
      block: await this.blocksService.create(user.id, body.blockedUserId),
    });
  }

  @Delete(':blockedUserId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('blockedUserId') blockedUserId: string,
  ) {
    return envelope(await this.blocksService.remove(user.id, blockedUserId));
  }
}
