import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { envelope } from '@app/common/api-response';
import { AuthGuard } from '@app/modules/auth/auth.guard';
import { CurrentUser } from '@app/modules/auth/current-user.decorator';
import { AuthenticatedUser } from '@app/modules/auth/auth.types';
import { CharactersService } from './characters.service';
import { UpdateCharacterDto } from './dto/update-character.dto';
import { UnlockCharacterDto } from './dto/unlock-character.dto';

@Controller('characters')
@UseGuards(AuthGuard)
export class CharactersController {
  constructor(private readonly characters: CharactersService) {}

  @Get()
  async list() {
    return envelope({ characters: await this.characters.listCharacters() });
  }

  @Get('items')
  async items(@Query('characterId') characterId?: string) {
    return envelope({
      items: await this.characters.listItems(characterId),
    });
  }

  @Get('animations')
  async animations() {
    return envelope({
      animations: this.characters.listAnimations(),
    });
  }

  @Get('me')
  async getMine(@CurrentUser() user: AuthenticatedUser) {
    const [character, owned, inventory, coins] = await Promise.all([
      this.characters.getSelection(user.id),
      this.characters.getOwnedCharacterIds(user.id),
      this.characters.getInventory(user.id),
      this.characters.getCoins(user.id),
    ]);
    return envelope({
      character,
      ownedCharacterIds: [...owned],
      inventory,
      eventCoins: coins,
    });
  }

  @Put('me')
  async saveMine(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateCharacterDto,
  ) {
    const loadout = {
      ...(body.loadout ?? {}),
      ...(body.accessoryIds ? { accessoryIds: body.accessoryIds } : {}),
    };
    return envelope({
      character: await this.characters.saveSelection(
        user.id,
        body.characterId,
        loadout,
      ),
    });
  }

  @Get('me/inventory')
  async inventory(@CurrentUser() user: AuthenticatedUser) {
    return envelope({
      items: await this.characters.getInventory(user.id),
    });
  }

  @Get('me/coins')
  async coins(@CurrentUser() user: AuthenticatedUser) {
    return envelope({
      eventCoins: await this.characters.getCoins(user.id),
    });
  }

  @Post('me/unlock')
  async unlock(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UnlockCharacterDto,
  ) {
    return envelope(
      await this.characters.unlockCharacter(user.id, body.characterId),
    );
  }

  // Event reward hook (system-granted cosmetics persist after the event).
  // Wired to the event layer later; guarded by moderation role for now.
  @Post('admin/grant-item/:userId')
  async grantItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') targetUserId: string,
    @Body() body: { itemId: string; eventId?: string },
  ) {
    if (user.role !== 'admin' && user.role !== 'owner') {
      throw new ForbiddenException('NOT_AUTHORIZED');
    }
    await this.characters.grantItem(
      targetUserId,
      body.itemId,
      body.eventId,
    );
    return envelope({ granted: true });
  }

  @Post('admin/grant-coins/:userId')
  async grantCoins(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') targetUserId: string,
    @Body() body: { amount: number; reason: string },
  ) {
    if (user.role !== 'admin' && user.role !== 'owner') {
      throw new ForbiddenException('NOT_AUTHORIZED');
    }
    const balance = await this.characters.grantCoins(
      targetUserId,
      body.amount,
      body.reason,
    );
    return envelope({ eventCoins: balance });
  }
}
