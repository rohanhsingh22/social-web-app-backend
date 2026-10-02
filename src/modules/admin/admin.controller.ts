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
import { AdminService } from './admin.service';
import { AdminReadsService } from './admin-reads.service';
import { AdminCasesService } from './admin-cases.service';
import { AdminOpsService } from './admin-ops.service';
import { AdminAuthGuard } from './auth/admin-auth.guard';
import { AdminPermissionsGuard } from './auth/admin-permissions.guard';
import { RequirePermissions } from './auth/require-permissions.decorator';
import { CurrentAdmin } from './auth/current-admin.decorator';
import type { AdminRequestUser } from './auth/admin-auth.guard';
import { AdminActionDto } from './dto/admin-action.dto';
import { AdminAuditQueryDto } from './dto/admin-audit-query.dto';
import { AdminOverviewQueryDto } from './dto/admin-overview-query.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { AdminCasesQueryDto } from './dto/admin-cases-query.dto';
import { AdminCaseResolveDto } from './dto/admin-case-resolve.dto';
import { AdminContentQueryDto } from './dto/admin-content-query.dto';
import { AdminNoticesQueryDto } from './dto/admin-notices-query.dto';
import { BannedWordPreviewDto } from './dto/banned-word-preview.dto';
import { AdminAnalyticsQueryDto } from './dto/admin-analytics-query.dto';
import { AdminFailedJobsQueryDto } from './dto/admin-ops-query.dto';
import { CreateBannedWordDto, UpdateBannedWordDto } from './dto/banned-word.dto';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel-admin.dto';
import { LegalNoticeDto } from './dto/legal-notice.dto';
import { ReportStatusDto } from './dto/report-status.dto';

// Phase 1: isolated admin sessions (AdminAuthGuard) + per-route permissions.
// The blanket AdminGuard is retired from this controller; social JWTs no
// longer authorize any route here.
@Controller('admin')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminReads: AdminReadsService,
    private readonly adminCases: AdminCasesService,
    private readonly adminOps: AdminOpsService,
  ) {}

  // ---- Phase 2 reads: overview, users, audit ----

  @Get('overview')
  @RequirePermissions('overview.read')
  async overview(
    @CurrentAdmin() admin: AdminRequestUser,
    @Query() query: AdminOverviewQueryDto,
  ) {
    return envelope(await this.adminReads.getOverview(admin, query));
  }

  @Get('users')
  @RequirePermissions('users.read')
  async users(@Query() query: AdminUsersQueryDto) {
    return envelope(await this.adminReads.listUsers(query));
  }

  @Get('users/:id')
  @RequirePermissions('users.read')
  async userDetail(@Param('id') id: string) {
    return envelope({ user: await this.adminReads.getUserDetail(id) });
  }

  @Get('users/:id/moderation-history')
  @RequirePermissions('users.read')
  async userModerationHistory(@Param('id') id: string) {
    return envelope(await this.adminReads.getUserModerationHistory(id));
  }

  @Get('audit')
  @RequirePermissions('audit.read')
  async audit(
    @CurrentAdmin() admin: AdminRequestUser,
    @Query() query: AdminAuditQueryDto,
  ) {
    return envelope(await this.adminReads.listAudit(admin, query));
  }

  // ---- Phase 3: unified moderation cases + content ----

  @Get('moderation/cases')
  @RequirePermissions('reports.read')
  async cases(
    @CurrentAdmin() admin: AdminRequestUser,
    @Query() query: AdminCasesQueryDto,
  ) {
    return envelope(await this.adminCases.listCases(admin, query));
  }

  @Get('moderation/cases/:id')
  @RequirePermissions('reports.read')
  async caseDetail(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
  ) {
    return envelope(await this.adminCases.getCaseDetail(admin, decodeURIComponent(id)));
  }

  @Post('moderation/cases/:id/claim')
  @RequirePermissions('reports.assign')
  async claimCase(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
  ) {
    return envelope(
      await this.adminCases.claimCase(admin.id, decodeURIComponent(id)),
    );
  }

  @Post('moderation/cases/:id/resolve')
  @RequirePermissions('reports.resolve')
  async resolveCase(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: AdminCaseResolveDto,
  ) {
    return envelope(
      await this.adminCases.resolveCase(admin.id, decodeURIComponent(id), body),
    );
  }

  @Get('content/thoughts')
  @RequirePermissions('reports.read')
  async contentThoughts(@Query() query: AdminContentQueryDto) {
    return envelope(await this.adminReads.listThoughts(query));
  }

  @Get('content/channel-messages')
  @RequirePermissions('reports.read')
  async contentChannelMessages(@Query() query: AdminContentQueryDto) {
    return envelope(await this.adminReads.listChannelMessages(query));
  }

  @Get('reports')
  @RequirePermissions('reports.read')
  async reports(
    @Query('status') status?: ReportStatus,
    @Query('limit') limit?: string,
  ) {
    return envelope({
      reports: await this.adminService.listReports(status, limit),
    });
  }

  @Post('reports/:id/resolve')
  @RequirePermissions('reports.resolve')
  async resolveReport(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: ReportStatusDto,
  ) {
    return envelope({
      report: await this.adminService.resolveReport(
        id,
        admin.id,
        body.status,
        body.reason,
      ),
    });
  }

  @Post('users/:id/mute')
  @RequirePermissions('users.mute')
  async mute(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      user: await this.adminService.muteUser(admin.id, id, body),
    });
  }

  @Post('users/:id/unmute')
  @RequirePermissions('users.mute')
  async unmute(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      user: await this.adminService.unmuteUser(admin.id, id, body),
    });
  }

  @Post('users/:id/ban')
  @RequirePermissions('users.ban')
  async ban(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      user: await this.adminService.banUser(admin.id, id, body),
    });
  }

  @Post('users/:id/unban')
  @RequirePermissions('users.ban')
  async unban(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      user: await this.adminService.unbanUser(admin.id, id, body),
    });
  }

  @Delete('channel-messages/:id')
  @RequirePermissions('content.remove')
  async deleteChannelMessage(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      message: await this.adminService.deleteChannelMessage(admin.id, id, body),
    });
  }

  @Delete('direct-messages/:id')
  @RequirePermissions('content.remove')
  async deleteDirectMessage(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      message: await this.adminService.deleteDirectMessage(admin.id, id, body),
    });
  }

  @Delete('thoughts/:id')
  @RequirePermissions('content.remove')
  async deleteThought(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: AdminActionDto,
  ) {
    return envelope({
      thought: await this.adminService.deleteThought(admin.id, id, body),
    });
  }

  @Get('thought-reports')
  @RequirePermissions('reports.read')
  async thoughtReports(
    @Query('status') status?: ReportStatus,
    @Query('limit') limit?: string,
  ) {
    return envelope({
      reports: await this.adminService.listThoughtReports(status, limit),
    });
  }

  @Post('thought-reports/:id/resolve')
  @RequirePermissions('reports.resolve')
  async resolveThoughtReport(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: ReportStatusDto,
  ) {
    return envelope({
      report: await this.adminService.resolveThoughtReport(
        id,
        admin.id,
        body.status,
        body.reason,
      ),
    });
  }

  @Post('channels')
  @RequirePermissions('channels.write')
  async createChannel(
    @CurrentAdmin() admin: AdminRequestUser,
    @Body() body: CreateChannelDto,
  ) {
    return envelope({
      channel: await this.adminService.createChannel(admin.id, body),
    });
  }

  @Patch('channels/:id')
  @RequirePermissions('channels.write')
  async updateChannel(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: UpdateChannelDto,
  ) {
    return envelope({
      channel: await this.adminService.updateChannel(admin.id, id, body),
    });
  }

  @Get('channels')
  @RequirePermissions('channels.read')
  async channels() {
    return envelope(await this.adminReads.listChannels());
  }

  @Get('channels/:id/metrics')
  @RequirePermissions('channels.read')
  async channelMetrics(@Param('id') id: string) {
    return envelope(await this.adminReads.channelMetrics(id));
  }

  @Get('tolis/overview')
  @RequirePermissions('toli.system.read')
  async tolisOverview() {
    return envelope(await this.adminReads.toliOverview());
  }

  @Get('banned-words')
  @RequirePermissions('dictionary.write')
  async bannedWords() {
    return envelope({
      bannedWords: await this.adminService.listBannedWords(),
    });
  }

  @Post('banned-words/preview')
  @RequirePermissions('dictionary.write')
  async previewBannedWord(@Body() body: BannedWordPreviewDto) {
    return envelope(await this.adminService.previewBannedWords(body.text));
  }

  @Post('banned-words')
  @RequirePermissions('dictionary.write')
  async createBannedWord(
    @CurrentAdmin() admin: AdminRequestUser,
    @Body() body: CreateBannedWordDto,
  ) {
    return envelope({
      bannedWord: await this.adminService.createBannedWord(admin.id, body),
    });
  }

  @Post('legal-notices')
  @RequirePermissions('notices.publish')
  async sendLegalNotice(
    @CurrentAdmin() admin: AdminRequestUser,
    @Body() body: LegalNoticeDto,
  ) {
    return envelope({
      notification: await this.adminService.sendLegalNotice(admin.id, body),
    });
  }

  @Get('legal-notices')
  @RequirePermissions('notices.publish')
  async legalNotices(@Query() query: AdminNoticesQueryDto) {
    return envelope(await this.adminReads.noticeHistory(query));
  }

  // ---- Phase 5: analytics + ops ----

  @Get('analytics/overview')
  @RequirePermissions('analytics.read')
  async analyticsOverview(@Query() query: AdminAnalyticsQueryDto) {
    return envelope(await this.adminReads.getAnalyticsOverview(query));
  }

  @Get('analytics/activity')
  @RequirePermissions('analytics.read')
  async analyticsActivity(@Query() query: AdminAnalyticsQueryDto) {
    return envelope(await this.adminReads.getAnalyticsActivity(query));
  }

  @Get('ops/health')
  @RequirePermissions('ops.read')
  async opsHealth() {
    return envelope(await this.adminOps.getHealth());
  }

  @Get('ops/queues')
  @RequirePermissions('ops.read')
  async opsQueues() {
    return envelope(await this.adminOps.getQueues());
  }

  @Get('ops/failed-jobs')
  @RequirePermissions('ops.read')
  async opsFailedJobs(@Query() query: AdminFailedJobsQueryDto) {
    return envelope(await this.adminOps.getFailedJobs(query.cursor, query.limit));
  }

  @Patch('banned-words/:id')
  @RequirePermissions('dictionary.write')
  async updateBannedWord(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: UpdateBannedWordDto,
  ) {
    return envelope({
      bannedWord: await this.adminService.updateBannedWord(admin.id, id, body),
    });
  }

  @Delete('banned-words/:id')
  @RequirePermissions('dictionary.write')
  async deleteBannedWord(
    @CurrentAdmin() admin: AdminRequestUser,
    @Param('id') id: string,
  ) {
    return envelope({
      bannedWord: await this.adminService.deleteBannedWord(admin.id, id),
    });
  }
}
