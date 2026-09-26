import type { PrismaService } from '@app/core/prisma/prisma.service';

// Avatar privacy (settings.profileVisibility.avatar) must hold on every
// social surface — thoughts, channel messages, DMs, connections, search,
// blocks — not just the public profile page. Hidden means: no avatar URL,
// no Toli key, provider fallback (mirrors ProfilesService.getUserProfile).
// A missing settings row (or missing key) means visible (default true).
export function isAvatarVisible(profileVisibility: unknown): boolean {
  if (!profileVisibility || typeof profileVisibility !== 'object') {
    return true;
  }

  return (profileVisibility as Record<string, unknown>).avatar !== false;
}

// Flat profile shape (Prisma selects) sanitized without dropping sibling
// fields: hidden means no avatar URL, no Toli key, provider fallback.
export function hideAvatarFields<
  T extends {
    avatarUrl: unknown;
    profilePictureType: unknown;
    toliAvatarKey: unknown;
  },
>(profile: T): T {
  return {
    ...profile,
    avatarUrl: null,
    profilePictureType: 'provider',
    toliAvatarKey: null,
  };
}

export function applyAvatarVisibility<
  T extends {
    avatarUrl: unknown;
    profilePictureType: unknown;
    toliAvatarKey: unknown;
  },
>(profile: T, visible: boolean): T {
  return visible ? profile : hideAvatarFields(profile);
}

// Batch avatar visibility by user id. Callers add their own self-bypass
// (viewer always sees their own avatar) by overwriting the viewer's entry.
export async function fetchAvatarVisibility(
  prisma: PrismaService,
  userIds: string[],
): Promise<Map<string, boolean>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const result = new Map<string, boolean>();

  if (unique.length === 0) {
    return result;
  }

  const rows = await prisma.userSettings.findMany({
    where: { userId: { in: unique } },
    select: { userId: true, profileVisibility: true },
  });

  const byId = new Map(
    rows.map((row) => [row.userId, row.profileVisibility]),
  );

  for (const id of unique) {
    result.set(id, isAvatarVisible(byId.get(id)));
  }

  return result;
}
