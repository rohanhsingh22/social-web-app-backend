import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { envelope } from '@app/common/api-response';
import { AuthGuard } from '@app/modules/auth/auth.guard';
import { CurrentUser } from '@app/modules/auth/current-user.decorator';
import { AuthenticatedUser } from '@app/modules/auth/auth.types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfilesService } from './profiles.service';

@Controller('profiles')
@UseGuards(AuthGuard)
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return envelope({
      profile: await this.profilesService.getOwnProfile(user.id),
    });
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProfileDto,
  ) {
    return envelope({
      profile: await this.profilesService.updateOwnProfile(user.id, body),
    });
  }

 @Get(':publicUserId')
  async getUserProfile(
    @Param('publicUserId') publicUserId: string,
  ) {
    return envelope({
      profile: await this.profilesService.getUserProfile(publicUserId),
    });
  }
}
