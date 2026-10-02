export type NormalizedProfile = {
  providerUserId: string;
  email?: string;
  displayName: string;
  avatarUrl?: string;
};

export type ProviderInfo = {
  id: string;
  displayName: string;
};

export interface OAuthProvider {
  readonly id: string;
  readonly displayName: string;

  // redirectUri overrides the configured callback (e.g. separate admin flow).
  getLoginUrl(state: string, redirectUri?: string): Promise<string>;
  exchangeCode(code: string, redirectUri?: string): Promise<string>;
  fetchProfile(accessToken: string): Promise<NormalizedProfile>;
}
