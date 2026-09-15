// Fixed Toli avatar catalog (Launch 1: 5 Tolies x 5 avatars).
// Assets remain frontend/static files; the backend only ever stores and
// validates catalog keys, never arbitrary frontend-provided URLs.
// Key format: <toli-lowercase>_<nn>, e.g. vector_01 .. flux_05.

export const TOLI_NAMES = [
  'Vector',
  'Wave',
  'Quantum',
  'Orbit',
  'Flux',
] as const;

export type ToliName = (typeof TOLI_NAMES)[number];

const AVATARS_PER_TOLI = 5;

const pad = (n: number): string => String(n).padStart(2, '0');

export const TOLI_AVATAR_KEYS: Record<ToliName, readonly string[]> =
  buildCatalog();

function buildCatalog(): Record<ToliName, readonly string[]> {
  const catalog = {} as Record<ToliName, readonly string[]>;

  for (const name of TOLI_NAMES) {
    catalog[name] = Array.from(
      { length: AVATARS_PER_TOLI },
      (_, i) => `${name.toLowerCase()}_${pad(i + 1)}`,
    );
  }

  return catalog;
}

export function isToliName(value: string): value is ToliName {
  return (TOLI_NAMES as readonly string[]).includes(value);
}

export function isToliAvatarKeyForToli(
  toliName: string,
  avatarKey: string,
): boolean {
  if (!isToliName(toliName)) {
    return false;
  }

  return TOLI_AVATAR_KEYS[toliName].includes(avatarKey);
}

export function toliNameForAvatarKey(avatarKey: string): ToliName | null {
  for (const name of TOLI_NAMES) {
    if (TOLI_AVATAR_KEYS[name].includes(avatarKey)) {
      return name;
    }
  }

  return null;
}
