import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReportStatus } from '@prisma/client';
import { envelope } from '@app/common/api-response';
import { AuthGuard } from '@app/modules/auth/auth.guard';
import { CurrentUser } from '@app/modules/auth/current-user.decorator';
import { AuthenticatedUser } from '@app/modules/auth/auth.types';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { AdminActionDto } from './dto/admin-action.dto';
import { CreateBannedWordDto, UpdateBannedWordDto } from './dto/banned-word.dto';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel-admin.dto';
import { LegalNoticeDto } from './dto/legal-notice.dto';
import { ReportStatusDto } from './dto/report-status.dto';

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('reports')
  async reports(
    @Query('status') status?: ReportStatus,
    @Query('limit') limit?: string,
  ) {
    return envelope({
      reports: await this.adminService.listReports(status, limit),
    });
  }

  @Post('reports/:id/resolve')
  async resolveReport(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ReportStatusDto,
  ) {
    return envelope({
      report: await this.adminService.resolveReport(id, admin.id, body.status),
    });
  }

  @Post('users/:id/mute')
  async mute(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      user: await this.adminService.muteUser(admin.id, id, body),
    });
  }

  @Post('users/:id/unmute')
  async unmute(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      user: await this.adminService.unmuteUser(admin.id, id, body),
    });
  }

  @Post('users/:id/ban')
  async ban(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      user: await this.adminService.banUser(admin.id, id, body),
    });
  }

  @Post('users/:id/unban')
  async unban(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      user: await this.adminService.unbanUser(admin.id, id, body),
    });
  }

  @Delete('channel-messages/:id')
  async deleteChannelMessage(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      message: await this.adminService.deleteChannelMessage(admin.id, id, body),
    });
  }

  @Delete('direct-messages/:id')
  async deleteDirectMessage(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      message: await this.adminService.deleteDirectMessage(admin.id, id, body),
    });
  }

  @Post('channels')
  async createChannel(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: CreateChannelDto,
  ) {
    return envelope({
      channel: await this.adminService.createChannel(admin.id, body),
    });
  }

  @Patch('channels/:id')
  async updateChannel(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateChannelDto,
  ) {
    return envelope({
      channel: await this.adminService.updateChannel(admin.id, id, body),
    });
  }

  @Get('banned-words')
  async bannedWords() {
    return envelope({
      bannedWords: await this.adminService.listBannedWords(),
    });
  }

  @Post('banned-words')
  async createBannedWord(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: CreateBannedWordDto,
  ) {
    return envelope({
      bannedWord: await this.adminService.createBannedWord(admin.id, body),
    });
  }

  @Post('legal-notices')
  async sendLegalNotice(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: LegalNoticeDto,
  ) {
    return envelope({
      notification: await this.adminService.sendLegalNotice(admin.id, body),
    });
  }

  @Patch('banned-words/:id')
  async updateBannedWord(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateBannedWordDto,
  ) {
    return envelope({
      bannedWord: await this.adminService.updateBannedWord(admin.id, id, body),
    });
  }
}
