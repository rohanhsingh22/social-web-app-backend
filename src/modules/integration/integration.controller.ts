import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { IntegrationService } from './integration.service';
import { OAuthStateService } from './oauth-state.service';
import { ProviderRegistry } from './providers/provider.registry';
import { envelope } from '@app/common/api-response';

@Controller('auth')
export class IntegrationController {
  constructor(
    private readonly integrationService: IntegrationService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly oauthState: OAuthStateService,
    private readonly config: ConfigService,
  ) {}

  @Get('providers')
  listProviders() {
    return envelope({
      providers: this.integrationService.getAvailableProviders(),
    });
  }

  @Get(':provider')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async startLogin(
    @Param('provider') providerId: string,
    @Res() response: Response,
  ) {
    const provider = this.providerRegistry.getProvider(providerId);
    const state = await this.oauthState.createState(provider.id);
    const loginUrl = await provider.getLoginUrl(state);
    return response.redirect(loginUrl);
  }

  @Get(':provider/callback')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async handleCallback(
    @Param('provider') providerId: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    if (!code) {
      throw new UnauthorizedException('OAUTH_CODE_REQUIRED');
    }

    const provider = this.providerRegistry.getProvider(providerId);
    await this.oauthState.consumeState(provider.id, state);

    const result = await this.integrationService.loginWithCode(
      providerId,
      code,
      this.sessionContext(request),
    );

    this.setAuthCookies(response, result.accessToken, result.refreshToken);

    return response.redirect(
      `${this.config.getOrThrow<string>('app.frontendBaseUrl')}/auth/callback/success`,
    );
  }

  private sessionContext(request: Request) {
    return {
      ipAddress: request.ip,
      userAgent: request.header('user-agent'),
    };
  }

  private setAuthCookies(
    response: Response,
    _accessToken: string,
    refreshToken: string,
  ) {
    const secure = this.config.get<string>('app.nodeEnv') === 'production';

    // Single-transport model: see AuthController.
    response.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
}
