import { Prisma } from '@prisma/client';

// The public identity card returned on every social surface (chat, DMs,
// connections, search, thoughts, profiles). The visible identity is always
// the HiRotoli displayName plus the resolved profile picture — never the
// OAuth provider name. The 3D character (characterConfig) is never included.
export const profileCardSelect = {
  username: true,
  displayName: true,
  avatarUrl: true,
  profilePictureType: true,
  toliAvatarKey: true,
  toli: { select: { id: true, name: true } },
} satisfies Prisma.ProfileSelect;

export type ProfileCardSource = {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  profilePictureType: 'provider' | 'toli';
  toliAvatarKey: string | null;
  toli: { id: string; name: string } | null;
} | null;

export function toProfileCard(
  profile: ProfileCardSource,
  avatarVisible = true,
) {
  // A hidden avatar must not leak through the Toli key either: when avatar
  // visibility is off, viewers see the provider fallback (same rule as the
  // public profile page).
  const isToli = profile?.profilePictureType === 'toli' && avatarVisible;

  return {
    username: profile?.username ?? 'unknown',
    displayName: profile?.displayName ?? 'Unknown',
    // Toli avatars resolve from the frontend static catalog by key; no URL
    // is fabricated for them here.
    avatarUrl:
      avatarVisible && !isToli ? (profile?.avatarUrl ?? null) : null,
    profilePicture: {
      type: isToli ? ('toli' as const) : ('provider' as const),
      avatarUrl:
        avatarVisible && !isToli ? (profile?.avatarUrl ?? null) : null,
      toliAvatarKey: isToli ? (profile?.toliAvatarKey ?? null) : null,
    },
    toli: profile?.toli ?? null,
  };
}
