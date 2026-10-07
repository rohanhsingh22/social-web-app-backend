import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { envelope } from '@app/common/api-response';
import { AuthGuard } from '@app/modules/auth/auth.guard';
import { CurrentUser } from '@app/modules/auth/current-user.decorator';
import { AuthenticatedUser } from '@app/modules/auth/auth.types';
import { HomeFeatureGuard } from './home-feature.guard';
import { InviteToHomeDto } from './dto/invite-to-home.dto';
import { RequestHomeJoinDto } from './dto/request-home-join.dto';
import { HomeInvitationService } from './home-invitation.service';
import { HomeJoinRequestService } from './home-join-request.service';
import { HomeMembershipService } from './home-membership.service';
import { HomeService } from './home.service';
import { HomeThemeResolver } from './world/home-theme-resolver';
import { HomeVoiceService } from './voice/home-voice.service';

// Phase 3: invitations. Phase 4: join requests. Phase 5: reads.
@Controller('home')
@UseGuards(HomeFeatureGuard, AuthGuard)
export class HomeController {
  constructor(
    private readonly homes: HomeService,
    private readonly memberships: HomeMembershipService,
    private readonly invitations: HomeInvitationService,
    private readonly joinRequests: HomeJoinRequestService,
    private readonly voice: HomeVoiceService,
    private readonly themes: HomeThemeResolver,
  ) {}

  @Get('world')
  async getWorld() {
    return envelope(await this.themes.getActiveTheme());
  }

  @Get()
  async getHome(@CurrentUser() user: AuthenticatedUser) {
    return envelope({ home: await this.homes.getHomeState(user.id) });
  }

  @Get('connections')
  async getConnections(@CurrentUser() user: AuthenticatedUser) {
    return envelope({
      connections: await this.homes.getHomeConnections(user.id),
    });
  }

  @Post('invitations')
  async invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: InviteToHomeDto,
  ) {
    return envelope({
      invitation: await this.invitations.createInvitation(
        user.id,
        body.inviteeId,
      ),
    });
  }

  @Post('invitations/:id/accept')
  async acceptInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return envelope({
      home: await this.invitations.acceptInvitation(user.id, id),
    });
  }

  @Post('invitations/:id/reject')
  async rejectInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return envelope({
      invitation: await this.invitations.rejectInvitation(user.id, id),
    });
  }

  @Post('join-requests')
  async requestJoin(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RequestHomeJoinDto,
  ) {
    return envelope({
      joinRequest: await this.joinRequests.createJoinRequest(
        user.id,
        body.targetMemberId,
      ),
    });
  }

  @Post('join-requests/:id/accept')
  async acceptJoinRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return envelope({
      home: await this.joinRequests.acceptJoinRequest(user.id, id),
    });
  }

  @Post('join-requests/:id/reject')
  async rejectJoinRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return envelope({
      joinRequest: await this.joinRequests.rejectJoinRequest(user.id, id),
    });
  }

  @Post('voice/token')
  async voiceToken(@CurrentUser() user: AuthenticatedUser) {
    return envelope(await this.voice.createVoiceToken(user.id));
  }

  @Post('leave')
  async leave(@CurrentUser() user: AuthenticatedUser) {
    return envelope(await this.memberships.leaveHome(user.id));
  }

  @Delete('members/:userId')
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const membership = await this.memberships.getMembership(user.id);
    if (!membership) {
      throw new ForbiddenException('NOT_HOME_MEMBER');
    }
    return envelope(
      await this.memberships.removeMember(membership.homeId, user.id, userId),
    );
  }
}
