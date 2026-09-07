import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NormalizedProfile,
  OAuthProvider,
} from './oauth-provider.interface';

@Injectable()
export class GoogleProvider implements OAuthProvider {
  readonly id = 'google';
  readonly displayName = 'Google';
  private readonly logger = new Logger(GoogleProvider.name);

  private readonly authUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  private readonly tokenUrl = 'https://oauth2.googleapis.com/token';
  private readonly profileUrl = 'https://www.googleapis.com/oauth2/v2/userinfo';

  constructor(private readonly config: ConfigService) {}

  async getLoginUrl(): Promise<string> {
    const clientId = this.config.get<string>('auth.googleClientId');
    const callbackUrl = this.config.get<string>('auth.googleCallbackUrl');

    if (!clientId || !callbackUrl) {
      this.logger.warn('Google auth attempted but is not configured');
      throw new BadRequestException('GOOGLE_AUTH_NOT_CONFIGURED');
    }

    const url = new URL(this.authUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');

    return url.toString();
  }

  async exchangeCode(code: string): Promise<string> {
    const clientId = this.config.get<string>('auth.googleClientId');
    const clientSecret = this.config.get<string>('auth.googleClientSecret');
    const callbackUrl = this.config.get<string>('auth.googleCallbackUrl');

    if (!clientId || !clientSecret || !callbackUrl) {
      this.logger.warn('Google token exchange attempted but is not configured');
      throw new BadRequestException('GOOGLE_AUTH_NOT_CONFIGURED');
    }

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      this.logger.error(
        `Google token exchange failed with status ${response.status}`,
      );
      throw new UnauthorizedException('GOOGLE_TOKEN_EXCHANGE_FAILED');
    }

    const body = (await response.json()) as { access_token?: string };

    if (!body.access_token) {
      this.logger.error('Google token exchange response missing access_token');
      throw new UnauthorizedException('GOOGLE_TOKEN_MISSING');
    }

    return body.access_token;
  }

  async fetchProfile(accessToken: string): Promise<NormalizedProfile> {
    const response = await fetch(this.profileUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      this.logger.error(
        `Google profile fetch failed with status ${response.status}`,
      );
      throw new UnauthorizedException('GOOGLE_PROFILE_FETCH_FAILED');
    }

    const profile = (await response.json()) as {
      id: string;
      name?: string;
      email?: string;
      picture?: string;
    };

    if (!profile.id) {
      this.logger.error('Google profile fetch response missing id');
      throw new UnauthorizedException('GOOGLE_PROFILE_INVALID');
    }

    return {
      providerUserId: profile.id,
      email: profile.email,
      displayName: profile.name ?? 'Google User',
      avatarUrl: profile.picture,
    };
  }
}
