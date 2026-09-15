import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';
import { OAuthStateService } from './oauth-state.service';
import { ProviderRegistry } from './providers/provider.registry';
import { FacebookProvider } from './providers/facebook.provider';
import { GoogleProvider } from './providers/google.provider';
import { OAuthProvider } from './providers/oauth-provider.interface';

const OAUTH_PROVIDERS = 'OAUTH_PROVIDERS';

@Module({
  controllers: [IntegrationController],
  providers: [
    IntegrationService,
    OAuthStateService,
    ProviderRegistry,
    FacebookProvider,
    GoogleProvider,
    {
      provide: OAUTH_PROVIDERS,
      inject: [FacebookProvider, GoogleProvider],
      useFactory: (
        facebook: OAuthProvider,
        google: OAuthProvider,
      ): OAuthProvider[] => [facebook, google],
    },
  ],
  exports: [IntegrationService, ProviderRegistry],
})
export class IntegrationModule {}
