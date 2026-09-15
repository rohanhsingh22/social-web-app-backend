import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
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

  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
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
    _accessToken: string,
    refreshToken: string,
  ) {
    const secure = this.config.get<string>('app.nodeEnv') === 'production';

    // Single-transport model: access token lives in frontend memory and is
    // sent via Authorization header; only the refresh token uses an HttpOnly
    // cookie. _accessToken is returned in the response body instead.
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
