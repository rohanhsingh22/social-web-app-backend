// Character write abuse protection (Phase 9, task 14).
// Selection/ownership/economy writes are low-frequency user actions —
// tight per-user buckets stop spam/botting without touching honest use.
// Counts live in Redis via RateLimitService; AuthGuard already runs first.

export const CHARACTER_SAVE_RATE_LIMIT = 30;

export const CHARACTER_SAVE_RATE_WINDOW_SECONDS = 60;

export const CHARACTER_UNLOCK_RATE_LIMIT = 10;

export const CHARACTER_UNLOCK_RATE_WINDOW_SECONDS = 60;

export const CHARACTER_GRANT_RATE_LIMIT = 20;

export const CHARACTER_GRANT_RATE_WINDOW_SECONDS = 60;
