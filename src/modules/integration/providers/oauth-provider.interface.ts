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

  getLoginUrl(state: string): Promise<string>;
  exchangeCode(code: string): Promise<string>;
  fetchProfile(accessToken: string): Promise<NormalizedProfile>;
}
