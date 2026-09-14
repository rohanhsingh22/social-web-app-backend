import { randomBytes } from "crypto";

export const PUBLIC_USER_ID_PREFIX = "HT-";
export const PUBLIC_USER_ID_BODY_LENGTH = 8;
export const PUBLIC_USER_ID_ALPHABET =
  "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const PUBLIC_USER_ID_PATTERN = new RegExp(
  `^${PUBLIC_USER_ID_PREFIX}[${PUBLIC_USER_ID_ALPHABET}]{${PUBLIC_USER_ID_BODY_LENGTH}}$`,
);

export function generatePublicUserId(): string {
  const bytes = randomBytes(PUBLIC_USER_ID_BODY_LENGTH);
  let body = "";

  for (let i = 0; i < PUBLIC_USER_ID_BODY_LENGTH; i += 1) {
    body += PUBLIC_USER_ID_ALPHABET[bytes[i]! % PUBLIC_USER_ID_ALPHABET.length];
  }

  return `${PUBLIC_USER_ID_PREFIX}${body}`;
}

export function normalizePublicUserId(input: string): string | null {
  const normalized = input.trim().toUpperCase();

  if (!PUBLIC_USER_ID_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}
