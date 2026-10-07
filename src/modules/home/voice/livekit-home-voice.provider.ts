import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import {
  HomeVoiceProvider,
  HomeVoiceToken,
} from './home-voice.provider';

/**
 * LiveKit-backed HomeVoiceProvider (Phase 7).
 * Mints short-lived join tokens and performs server-side participant/room
 * removal. The API secret never leaves this process. Unconfigured outside
 * provisioned environments — every method fails closed with VOICE_UNAVAILABLE.
 */
@Injectable()
export class LivekitHomeVoiceProvider extends HomeVoiceProvider {
  constructor(private readonly config: ConfigService) {
    super();
  }

  override async createAccessToken(params: {
    roomName: string;
    identity: string;
    ttlSeconds: number;
  }): Promise<HomeVoiceToken> {
    const { apiKey, apiSecret } = this.credentials();
    const token = new AccessToken(apiKey, apiSecret, {
      identity: params.identity,
      ttl: params.ttlSeconds,
    });
    token.addGrant({
      roomJoin: true,
      room: params.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    return {
      token: await token.toJwt(),
      expiresAt: new Date(Date.now() + params.ttlSeconds * 1000),
    };
  }

  override async removeParticipant(
    roomName: string,
    identity: string,
  ): Promise<void> {
    await this.rooms().removeParticipant(roomName, identity);
  }

  override async closeHome(roomName: string): Promise<void> {
    await this.rooms().deleteRoom(roomName);
  }

  private credentials(): { apiKey: string; apiSecret: string; url: string } {
    const url = this.config.get<string>('voice.livekitUrl');
    const apiKey = this.config.get<string>('voice.livekitApiKey');
    const apiSecret = this.config.get<string>('voice.livekitApiSecret');
    if (!url || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('VOICE_UNAVAILABLE');
    }
    return { url, apiKey, apiSecret };
  }

  private rooms(): RoomServiceClient {
    const { url, apiKey, apiSecret } = this.credentials();
    return new RoomServiceClient(url, apiKey, apiSecret);
  }
}
