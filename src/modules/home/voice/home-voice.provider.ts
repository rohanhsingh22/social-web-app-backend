// Hirotoli owns membership; the voice provider owns the media connection
// (spec #22). This abstraction keeps LiveKit specifics out of the Home
// domain so a future SFU swap never rewrites membership logic.

export type HomeVoiceToken = {
  token: string;
  expiresAt: Date;
};

export abstract class HomeVoiceProvider {
  abstract createAccessToken(params: {
    roomName: string;
    identity: string;
    ttlSeconds: number;
  }): Promise<HomeVoiceToken>;

  abstract removeParticipant(
    roomName: string,
    identity: string,
  ): Promise<void>;

  abstract closeHome(roomName: string): Promise<void>;
}
