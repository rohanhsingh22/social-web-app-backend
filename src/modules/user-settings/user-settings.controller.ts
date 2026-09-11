import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { envelope } from '@app/common/api-response';
import { AuthGuard } from '@app/modules/auth/auth.guard';
import { CurrentUser } from '@app/modules/auth/current-user.decorator';
import { AuthenticatedUser } from '@app/modules/auth/auth.types';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { UserSettingsService } from './user-settings.service';

@Controller('settings')
@UseGuards(AuthGuard)
export class UserSettingsController {
  constructor(private readonly userSettingsService: UserSettingsService) {}

  @Get()
  async getOwnSettings(@CurrentUser() user: AuthenticatedUser) {
    return envelope({
      settings: await this.userSettingsService.getOwnSettings(user.id),
    });
  }

  @Patch()
  async updateOwnSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateUserSettingsDto,
  ) {
    return envelope({
      settings: await this.userSettingsService.updateOwnSettings(user.id, body),
    });
  }
}
