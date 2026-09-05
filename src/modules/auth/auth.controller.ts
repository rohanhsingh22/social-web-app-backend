import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { envelope } from '@app/common/api-response';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AuthenticatedUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Get('facebook')
  startFacebookLogin(@Res() response: Response) {
    return response.redirect(this.authService.getFacebookLoginUrl());
  }

  @Get('facebook/callback')
  async facebookCallback(
    @Query('code') code: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    if (!code) {
      throw new UnauthorizedException('FACEBOOK_CODE_REQUIRED');
    }

    const result = await this.authService.loginWithFacebookCode(
      code,
      this.sessionContext(request),
    );

    this.setAuthCookies(response, result.accessToken, result.refreshToken);

    return response.redirect(
      `${this.config.getOrThrow<string>('app.frontendBaseUrl')}/auth/callback/success`,
    );
  }

  @Post('refresh')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.refresh(
      request.cookies?.refresh_token,
      this.sessionContext(request),
    );

    this.setAuthCookies(response, result.accessToken, result.refreshToken);

    return envelope({
      user: result.user,
      accessToken: result.accessToken,
    });
  }

  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.authService.logout(request.cookies?.refresh_token);
    this.clearAuthCookies(response);

    return envelope({ ok: true });
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    return envelope({ user: await this.authService.getMe(user.id) });
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

  private clearAuthCookies(response: Response) {
    response.clearCookie('access_token');
    response.clearCookie('refresh_token');
  }
}
