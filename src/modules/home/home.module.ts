import { Module } from '@nestjs/common';
import { RateLimitService } from '@app/common/rate-limit.service';
import { FanoutModule } from '@app/realtime/fanout/fanout.module';
import { PresenceModule } from '@app/realtime/presence/presence.module';
import { AuthModule } from '../auth/auth.module';
import { CharactersModule } from '../characters/characters.module';
import { HomeController } from './home.controller';
import { HomeFeatureGuard } from './home-feature.guard';
import { HomeInvitationService } from './home-invitation.service';
import { HomeJoinRequestService } from './home-join-request.service';
import { HomeMembershipService } from './home-membership.service';
import { HomePolicyService } from './home-policy.service';
import { HomePresenceService } from './home-presence.service';
import { HomeService } from './home.service';
import { HomeThemeResolver } from './world/home-theme-resolver';
import {
  HomeVoiceProvider,
} from './voice/home-voice.provider';
import { HomeVoiceService } from './voice/home-voice.service';
import {
  LivekitHomeVoiceProvider,
} from './voice/livekit-home-voice.provider';

// Phase 7: + voice provider and token issuance.
@Module({
  imports: [AuthModule, CharactersModule, FanoutModule, PresenceModule],
  controllers: [HomeController],
  providers: [
    HomeFeatureGuard,
    HomeService,
    HomeMembershipService,
    HomePolicyService,
    HomePresenceService,
    HomeInvitationService,
    HomeJoinRequestService,
    HomeVoiceService,
    { provide: HomeVoiceProvider, useClass: LivekitHomeVoiceProvider },
    HomeThemeResolver,
    RateLimitService,
  ],
  exports: [
    HomeService,
    HomeMembershipService,
    HomePolicyService,
    HomePresenceService,
    HomeVoiceService,
    HomeThemeResolver,
  ],
})
export class HomeModule {}
