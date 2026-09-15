import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { envelope } from '@app/common/api-response';
import { AuthGuard } from '@app/modules/auth/auth.guard';
import { AuthenticatedUser } from '@app/modules/auth/auth.types';
import { CurrentUser } from '@app/modules/auth/current-user.decorator';
import { CreateThoughtDto } from './dto/create-thought.dto';
import { CreateThoughtCommentDto } from './dto/create-thought-comment.dto';
import { ReportThoughtDto } from './dto/report-thought.dto';
import { ThoughtFeedQueryDto } from './dto/thought-feed-query.dto';
import { ThoughtsService } from './thoughts.service';

@Controller('thoughts')
@UseGuards(AuthGuard)
export class ThoughtsController {
  constructor(private readonly thoughtsService: ThoughtsService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateThoughtDto,
  ) {
    return envelope({
      thought: await this.thoughtsService.createThought(user, body.body),
    });
  }

  @Get('fresh')
  async fresh(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ThoughtFeedQueryDto,
  ) {
    return envelope(
      await this.thoughtsService.listFresh(user.id, query.cursor, query.limit),
    );
  }

  @Get('for-you')
  async forYou(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ThoughtFeedQueryDto,
  ) {
    return envelope(
      await this.thoughtsService.listForYou(user.id, query.cursor, query.limit),
    );
  }

  @Get(':id')
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return envelope({
      thought: await this.thoughtsService.getThought(user.id, id),
    });
  }

  @Get(':id/comments')
  async comments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: ThoughtFeedQueryDto,
  ) {
    return envelope(
      await this.thoughtsService.listComments(
        user.id,
        id,
        query.cursor,
        query.limit,
      ),
    );
  }

  @Post(':id/comments')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async comment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: CreateThoughtCommentDto,
  ) {
    return envelope({
      comment: await this.thoughtsService.createComment(user, id, body.body),
    });
  }

  @Post(':id/like')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async like(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return envelope(await this.thoughtsService.setLike(user, id, true));
  }

  @Delete(':id/like')
  async unlike(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return envelope(await this.thoughtsService.setLike(user, id, false));
  }

  @Post(':id/share')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async share(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return envelope(await this.thoughtsService.shareThought(user, id));
  }

  @Post(':id/hide')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async hide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return envelope(await this.thoughtsService.setHidden(user, id, true));
  }

  @Delete(':id/hide')
  async unhide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return envelope(await this.thoughtsService.setHidden(user, id, false));
  }

  @Post(':id/report')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async report(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ReportThoughtDto,
  ) {
    return envelope(await this.thoughtsService.reportThought(user, id, body));
  }
}
