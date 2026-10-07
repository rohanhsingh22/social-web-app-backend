// Hirotoli Home domain constants (Phase 1 foundation).
// Spec: max 4 members per Home; invitations and join requests live 20s.
// TTLs are server-authoritative; frontend timers are visual only.

export const MAX_HOME_MEMBERS = 4;

export const HOME_INVITATION_TTL_SECONDS = 20;

export const HOME_JOIN_REQUEST_TTL_SECONDS = 20;

// Abuse protection (spec #91-92). Centralized here, never hardcoded in
// controllers. Per-target pending is enforced as exactly one via duplicate
// checks; per-Home pending caps match the spec's own example (4 members,
// up to 20 pending invitations can coexist).
export const HOME_INVITE_RATE_LIMIT = 20;

export const HOME_INVITE_RATE_WINDOW_SECONDS = 60;

export const MAX_PENDING_INVITATIONS_PER_HOME = 20;

export const HOME_JOIN_REQUEST_RATE_LIMIT = 20;

export const HOME_JOIN_REQUEST_RATE_WINDOW_SECONDS = 60;

export const MAX_PENDING_JOIN_REQUESTS_PER_HOME = 20;

// General mutation abuse protection (spec #91, #18). Creation endpoints
// have tighter dedicated buckets above; every other Home mutation shares
// this per-user bucket. Centralized here, never hardcoded at call sites.
export const HOME_ACTION_RATE_LIMIT = 60;

export const HOME_ACTION_RATE_WINDOW_SECONDS = 60;

// Voice (Phase 7). Short-lived SFU tokens; the browser never sees the
// provider secret. Room names are opaque and stable per Home.
export const HOME_VOICE_ROOM_PREFIX = 'home_voice_';

export const HOME_VOICE_TOKEN_TTL_SECONDS = 3600;
