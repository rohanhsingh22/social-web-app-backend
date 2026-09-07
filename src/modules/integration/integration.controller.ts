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
import { IntegrationService } from './integration.service';
import { ProviderRegistry } from './providers/provider.registry';
import { envelope } from '@app/common/api-response';

@Controller('auth')
export class IntegrationController {
  constructor(
    private readonly integrationService: IntegrationService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly config: ConfigService,
  ) {}

  @Get('providers')
  listProviders() {
    return envelope({
      providers: this.integrationService.getAvailableProviders(),
    });
  }

  @Get(':provider')
  async startLogin(
    @Param('provider') providerId: string,
    @Res() response: Response,
  ) {
    const provider = this.providerRegistry.getProvider(providerId);
    const loginUrl = await provider.getLoginUrl();
    return response.redirect(loginUrl);
  }

  @Get(':provider/callback')
  async handleCallback(
    @Param('provider') providerId: string,
    @Query('code') code: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    if (!code) {
      throw new UnauthorizedException('OAUTH_CODE_REQUIRED');
    }

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
    accessToken: string,
    refreshToken: string,
  ) {
    const secure = this.config.get<string>('app.nodeEnv') === 'production';

    response.cookie('access_token', accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 15 * 60 * 1000,
    });
    response.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
}
