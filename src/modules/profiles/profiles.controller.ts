import { Body, Controller, Get, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { envelope } from '@app/common/api-response';
import { AuthGuard } from '@app/modules/auth/auth.guard';
import { CurrentUser } from '@app/modules/auth/current-user.decorator';
import { AuthenticatedUser } from '@app/modules/auth/auth.types';
import { CheckDisplayNameDto } from './dto/check-display-name.dto';
import { SelectToliDto } from './dto/select-toli.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateProfilePictureDto } from './dto/update-profile-picture.dto';
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

  @Get('me/picture')
  async getPicture(@CurrentUser() user: AuthenticatedUser) {
    return envelope(
      await this.profilesService.getProfilePicture(user.id),
    );
  }

  @Put('me/picture')
  async updatePicture(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProfilePictureDto,
  ) {
    return envelope(
      await this.profilesService.updateProfilePicture(user.id, body),
    );
  }

  @Put('me/toli')
  async selectToli(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SelectToliDto,
  ) {
    return envelope({
      profile: await this.profilesService.selectToli(user.id, body.toliId),
    });
  }

  @Get('check-display-name')
  async checkDisplayName(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CheckDisplayNameDto,
  ) {
    return envelope(
      await this.profilesService.checkDisplayNameAvailability(
        user.id,
        query.displayName,
      ),
    );
  }

  @Get(':publicUserId')
  async getUserProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('publicUserId') publicUserId: string,
  ) {
    return envelope({
      profile: await this.profilesService.getUserProfile(
        publicUserId,
        user.id,
      ),
    });
  }
}
