import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OAuthProvider, ProviderInfo } from './oauth-provider.interface';

@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);

  constructor(
    @Inject('OAUTH_PROVIDERS') private readonly providers: OAuthProvider[],
  ) {}

  getAvailableProviders(): ProviderInfo[] {
    return this.providers.map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
    }));
  }

  getProvider(id: string): OAuthProvider {
    const provider = this.providers.find((p) => p.id === id);

    if (!provider) {
      this.logger.warn(`OAuth provider "${id}" not found`);
      throw new NotFoundException(`PROVIDER_NOT_FOUND`);
    }

    return provider;
  }
}
