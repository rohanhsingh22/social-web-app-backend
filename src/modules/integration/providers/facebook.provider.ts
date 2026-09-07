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
export class FacebookProvider implements OAuthProvider {
  readonly id = 'facebook';
  readonly displayName = 'Facebook';
  private readonly logger = new Logger(FacebookProvider.name);

  private readonly authUrl = 'https://www.facebook.com/v21.0/dialog/oauth';
  private readonly tokenUrl =
    'https://graph.facebook.com/v21.0/oauth/access_token';
  private readonly profileUrl = 'https://graph.facebook.com/me';

  constructor(private readonly config: ConfigService) {}

  async getLoginUrl(): Promise<string> {
    const appId = this.config.get<string>('auth.facebookAppId');
    const callbackUrl = this.config.get<string>('auth.facebookCallbackUrl');

    if (!appId || !callbackUrl) {
      this.logger.warn('Facebook auth attempted but is not configured');
      throw new BadRequestException('FACEBOOK_AUTH_NOT_CONFIGURED');
    }

    const url = new URL(this.authUrl);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', 'public_profile,email');
    url.searchParams.set('response_type', 'code');

    return url.toString();
  }

  async exchangeCode(code: string): Promise<string> {
    const appId = this.config.get<string>('auth.facebookAppId');
    const appSecret = this.config.get<string>('auth.facebookAppSecret');
    const callbackUrl = this.config.get<string>('auth.facebookCallbackUrl');

    if (!appId || !appSecret || !callbackUrl) {
      this.logger.warn('Facebook token exchange attempted but is not configured');
      throw new BadRequestException('FACEBOOK_AUTH_NOT_CONFIGURED');
    }

    const url = new URL(this.tokenUrl);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('code', code);

    const response = await fetch(url);

    if (!response.ok) {
      this.logger.error(
        `Facebook token exchange failed with status ${response.status}`,
      );
      throw new UnauthorizedException('FACEBOOK_TOKEN_EXCHANGE_FAILED');
    }

    const body = (await response.json()) as { access_token?: string };

    if (!body.access_token) {
      this.logger.error('Facebook token exchange response missing access_token');
      throw new UnauthorizedException('FACEBOOK_TOKEN_MISSING');
    }

    return body.access_token;
  }

  async fetchProfile(accessToken: string): Promise<NormalizedProfile> {
    const url = new URL(this.profileUrl);
    url.searchParams.set('fields', 'id,name,email,picture');
    url.searchParams.set('access_token', accessToken);

    const response = await fetch(url);

    if (!response.ok) {
      this.logger.error(
        `Facebook profile fetch failed with status ${response.status}`,
      );
      throw new UnauthorizedException('FACEBOOK_PROFILE_FETCH_FAILED');
    }

    const profile = (await response.json()) as {
      id: string;
      name?: string;
      email?: string;
      picture?: { data?: { url?: string } };
    };

    if (!profile.id) {
      this.logger.error('Facebook profile fetch response missing id');
      throw new UnauthorizedException('FACEBOOK_PROFILE_INVALID');
    }

    return {
      providerUserId: profile.id,
      email: profile.email,
      displayName: profile.name ?? 'Facebook User',
      avatarUrl: profile.picture?.data?.url,
    };
  }
}
