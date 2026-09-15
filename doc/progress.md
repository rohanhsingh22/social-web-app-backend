# Progress & How to Access

Status of the Social Chat App backend, what is implemented so far, and how to run and exercise it.

## What is done

### Foundation (Phase 1)
- NestJS monorepo with three apps: `api`, `realtime`, `worker`.
- PostgreSQL (Prisma) and Redis wired up as global services.
- Config, request logging, and health checks in place.
- Prisma schema and `0001_init` migration cover the full V1 data model.

### Auth (Phase 2)
- Facebook OAuth flow: `GET /auth/facebook` and `GET /auth/facebook/callback`.
- Google/Gmail OAuth flow: `GET /auth/google` and `GET /auth/google/callback`.
- Session handling: JWT access token + refresh token (hashed, httpOnly cookie).
- `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`.
- `AuthGuard` for protected routes.

### Profiles (Phase 3)
- `GET /profiles/me`, `PATCH /profiles/me`, `GET /profiles/:username`.
- Username uniqueness, DOB -> age-group calculation, and profile-completion tracking.

### Channels (Phase 4)
- Channel list, default channel, and message history with cursor pagination.
- Seed data provides `general`, `english`, `hindi`, `gaming`, `study`, `music`.

### Realtime channel chat (Phase 5)
- Socket.IO `/channels` namespace.
- Guest read-only joins; authenticated sends.
- Redis Socket.IO adapter for horizontal scaling.
- Presence and online counts backed by Redis.
- Per-user message rate limiting.

## What is still stubbed

These routes exist but return placeholder/empty data and are not yet implemented:

- Blocks (`/blocks/*`) — Phase 8.
- Reports (`/reports`) — Phase 8.
- Admin moderation (`/admin/*`) — Phase 8.

## Additional features added

### Character customization
- `character_config` JSONB column added to profiles table with migration
- Profile update API merges character config (hair color, skin color, outfit color, gender)
- Public profile page (`/users/:username`) renders full-screen 3D character scene
- Clicking a username in chat redirects to their character profile

### Profile navigation in chat
- Messages include `profileUrl` in sender data for easy navigation
- Logged-in users can view other users' characters by clicking names in chat

### Connections and user search (Phase 6)
- Authenticated connection request APIs are implemented with duplicate and reversed-pair prevention.
- Accepting a connection creates or reuses a direct conversation for the pair.
- Every user has an immutable unique HiRotoli public ID (`publicUserId`, format `HT-XXXXXXXX`) assigned at signup and backfilled for existing users.
- `GET /users/search?q=HT-...` is an **exact public ID lookup** only (case-insensitive). It does not search username or display name. Returns 0 or 1 safe public profile plus viewer-relative connection status; excludes self, inactive, and blocked relationships.
- Connection requests and block create accept the target's **public** HiRotoli ID (not internal UUID).
- Own profile (`GET /profiles/me`) and `GET /auth/me` expose `publicUserId` for copy/share.
- Redis rate limits are enforced for connection requests and user search.

### Direct messages (Phase 7)
- Authenticated `/dm/conversations` and `/dm/conversations/:id/messages` endpoints are implemented.
- Direct message reads and sends require conversation membership, an accepted connection, and no block between users; sends also require an allowed sender account state.
- Socket.IO `/dm` namespace supports authenticated join/leave/send with Redis-backed per-user send rate limiting.

### Moderation (Phase 8)
- Authenticated reports can be created for users, channel messages, and accessible direct messages.
- Authenticated blocks can be listed, created, and removed; blocking disables active/pending relationships.
- Admin/moderator APIs can list and resolve reports, mute/ban/unmute/unban users, soft-delete channel and direct messages, manage channels, and manage banned words.
- Admin moderation actions write audit rows to `moderation_actions`.
- Channel and direct-message sends run basic spam and banned-word checks before messages are saved.

## What still needs launch/infrastructure work

- Upload APIs and profile image processing workers are still placeholders.
- Phase 9 production readiness still needs real load-test scripts/runs, monitoring integration, deployment pipeline, and a 5,000-socket load test against deployed infrastructure.

## How to run

On Windows PowerShell, use `npm.cmd` if `npm` is blocked.

1. Copy `.env.example` to `.env` and fill in the secrets.
2. Start PostgreSQL and Redis.
3. Install and prepare the DB:

```powershell
npm.cmd install
npm.cmd run prisma:generate
npm.cmd run prisma:migrate
npm.cmd run prisma:studio   # optional, to inspect data
```

4. Seed the default channels:

```powershell
npm.cmd exec prisma db seed
```

5. Start each app in its own terminal:

```powershell
npm.cmd run start:api:dev
npm.cmd run start:realtime:dev
npm.cmd run start:worker:dev
```

Default ports:

- API: `http://localhost:3000`
- Realtime: `ws://localhost:3001`
- Worker: port `3002`

## How to access / exercise it

### Public channel endpoints

```http
GET http://localhost:3000/channels
GET http://localhost:3000/channels/default
GET http://localhost:3000/channels/:slug
GET http://localhost:3000/channels/:slug/messages?cursor=...&limit=...
```

### Protected endpoints

```http
GET    http://localhost:3000/auth/me
GET    http://localhost:3000/profiles/me
PATCH  http://localhost:3000/profiles/me
GET    http://localhost:3000/profiles/:username
GET    http://localhost:3000/dm/conversations
GET    http://localhost:3000/dm/conversations/:id/messages?cursor=...&limit=...
POST   http://localhost:3000/reports
GET    http://localhost:3000/blocks
POST   http://localhost:3000/blocks
DELETE http://localhost:3000/blocks/:blockedUserId
GET    http://localhost:3000/admin/reports
POST   http://localhost:3000/admin/reports/:id/resolve
POST   http://localhost:3000/admin/users/:id/mute
POST   http://localhost:3000/admin/users/:id/unmute
POST   http://localhost:3000/admin/users/:id/ban
POST   http://localhost:3000/admin/users/:id/unban
DELETE http://localhost:3000/admin/channel-messages/:id
DELETE http://localhost:3000/admin/direct-messages/:id
POST   http://localhost:3000/admin/channels
PATCH  http://localhost:3000/admin/channels/:id
GET    http://localhost:3000/admin/banned-words
POST   http://localhost:3000/admin/banned-words
PATCH  http://localhost:3000/admin/banned-words/:id
```

### Socket events (`/channels` namespace)

Client emits:

- `channel:join` — `{ channelId: string }`
- `channel:leave` — `{ channelId: string }`
- `channel:message:send` — `{ channelId: string, body: string }`

Server emits:

- `channel:message:new`
- `channel:presence:update`
- `channel:error`
- `auth:error`
- `user:muted`
- `user:banned`

### Socket events (`/dm` namespace)

Client emits:

- `dm:join` - `{ conversationId: string }`
- `dm:leave` - `{ conversationId: string }`
- `dm:message:send` - `{ conversationId: string, body: string }`

Server emits:

- `dm:message:new`
- `dm:error`
- `auth:error`

## Validation

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd run test
npm.cmd run test:e2e
```

## Launch 1 implementation (per `updated-hirotoli-doc.txt`)

### Phase 0 — Baseline (2026-09-14)
- Backend `lint`/`build` pass; frontend `typecheck`/`build` pass, `lint` 0 errors + 3 pre-existing warnings.
- Fixed 2 stale specs (`channels` now expects `publicUserId`, `profiles` uses `getUserProfile`). Suite went 17/19 → 20/20.

### Phase 1 — Foundation fixes (2026-09-14)
- **OAuth state**: new `OAuthStateService` (Redis `oauth:state:*`, 10-min TTL, single-use `GETDEL`, fail-closed); `state` added to Google/Facebook login URLs and validated on callback.
- **OAuth sync**: repeat logins update `AuthIdentity` provider fields only; HiRotoli `displayName`/avatar no longer overwritten (avatar advances only while tracking the provider one).
- **Refresh**: `sessionId.secret` format validated before Prisma; rotation revokes atomically via `updateMany({revokedAt: null})` so concurrent reuse is rejected; malformed logout tokens ignored.
- **JWT**: `issuer` (`hirotoli-api`) + `audience` (`hirotoli-client`) on sign/verify; production boot requires `JWT_ACCESS_SECRET`; dead `JWT_REFRESH_SECRET` removed.
- **Transport**: refresh-only HttpOnly cookie; access token via body/memory + `Authorization` header (cookie read kept as transitional fallback).
- **Throttling**: `ThrottlerGuard` registered globally (120/min) + 30/min `POST /auth/refresh`, 20/min OAuth start/callback.
- **Sockets/callback**: channel + DM hooks refresh the token on `reconnect_attempt`; OAuth callback page does exactly one refresh (was two).
- **Display name**: `Profile.displayNameNormalized` (`@unique`) + migration `20260914000000_display_name_ci_unique` (backfill, dupe pre-check); `PATCH /profiles/me` trims + enforces case-insensitive uniqueness (`DISPLAY_NAME_TAKEN`, P2002 race mapped); new `GET /profiles/check-display-name`; OAuth signup suffixes colliding names; frontend `useLazyDisplayNameAvailabilityQuery` added.
- Pending deploy step: Neon unreachable from this machine, so the display-name migration is authored but not yet applied — run `prisma:migrate` where the DB is reachable.
- Verify: backend `lint`/`build` pass, `test --runInBand` **21/21 suites, 93/93 tests**; frontend `typecheck`/`lint`/`build` pass.

### Phase 2 — Database preparation (2026-09-14)
- **Toli**: new `tolis` table (`name` unique; Vector/Wave/Quantum/Orbit/Flux seeded idempotently in `seed.ts`); `Profile.toliId?` (indexed, `SetNull`) and `Channel.toliId?` (`@unique`, one room per Toli); `ChannelType` gains `toli`.
- **Avatar selection**: `Profile.profilePictureType` (`provider` default, `toli`) + `toliAvatarKey`; provider avatar stays on `AuthIdentity` (already there). Fixed 25-key catalog + validation land in Phase 4.
- **Thoughts**: `thoughts` (+ `(status, createdAt)` feed index) reusing `MessageStatus`; `thought_likes`/`thought_shares`/`thought_hides` (composite keys), `thought_comments`, `thought_reports` (reusing `ReportReason`/`ReportStatus`), `thought_events` (`thoughtId?` nullable for profile/connection events, `type` string + `metadata` JSONB).
- **Notifications**: single `notifications` table (`connection_request`/`connection_accepted`/`new_dm`/`legal_notice`), `(recipientId, createdAt)` + `(recipientId, readAt)` indexes.
- Migration `20260914010000_phase2_launch1_models` authored (additive only, no backfill needed); `prisma validate` + `prisma:generate` clean. Both pending migrations must be applied with `prisma:migrate` where Neon is reachable.
- Verify: backend `lint`/`build` pass, `test --runInBand` **21/21, 93/93**; `seed.ts` typechecks.

### Phase 3 — Profile completion (2026-09-14/15)
- **Interests**: `Profile.interests` (`TEXT[]`, default empty) + migration `20260914020000_profile_interests`; editable via `PATCH /profiles/me`, returned by profile APIs (visibility-gated with languages).
- **Picture API**: `GET /profiles/me/picture` + `PUT /profiles/me/picture` (`{type: provider|toli, avatarKey?}`). TOLI requires membership and a catalog key; backend stores keys only, never URLs. Fixed catalog `src/modules/toli/toli-avatars.ts` (5×5 keys `vector_01..flux_05`).
- **Response shaping**: own/public/updated profiles return `profilePicture {type, avatarUrl, toliAvatarKey, toli}` + `toli` + `interests`, separate from `characterConfig`; `PATCH /me` now returns the shaped own profile.
- **Onboarding (frontend)**: required Display Name field with 500ms debounced `check-display-name` lookup (taken/checking states block submit); `Profile`/`ProfilePicture`/`ToliRef` types + normalizers; picture get/put hooks added.
- Verify: backend `lint`/`build` pass, `test --runInBand` **21/21, 97/97**; frontend `typecheck`/`lint`/`build` pass. Three migrations now queue for a DB-connected `prisma:migrate`.

### Phase 4 — Toli (2026-09-15)
- **Membership API**: `GET /tolis` (+ avatars, member counts), `GET /tolis/:idOrName`, `PUT /profiles/me/toli {toliId|null}` for select/skip/change. Switching or leaving with a stale Toli avatar auto-resets the picture to provider; same-Toli calls no-op; unknown ids 404.
- **Rooms**: five private `toli-*` channels seeded (one per Toli, `type: toli`); public list/lookup/history/send paths explicitly exclude `type: toli`. New auth endpoints `GET /channels/toli/mine` + `/messages` (private cache headers, shared pagination/Redis cache).
- **Realtime**: gateway resolves public-then-Toli rooms; join/send require membership on every call (`AUTH_REQUIRED`/`TOLI_FORBIDDEN`, `channel:error` emitted on send). Sends share moderation/mapping via `persistChannelMessage`.
- **Frontend**: Toli RTK APIs + `ToliBadge`/`ToliPicker`/`ToliAvatarPicker`; onboarding Toli + avatar choice; Toli room at `/channels/toli-*` reusing the chat shell (guest gate, slug-mismatch guard, room entry in list + aside); settings “My Toli” section; profile header badge.
- Follow-up noted: Redis-backed socket kick on Toli change (Phase 10 hardening); stale-room reads currently cut off by client leave + per-call send/join checks.
- Verify: backend `lint`/`build` pass, `test --runInBand` **22/22, 110/110**; frontend `typecheck`/`lint`/`build` pass.

### Phase 5 — Thoughts (2026-09-15)
- **Backend** (`ThoughtsModule`): `POST /thoughts` (trim/moderation/rate-limit/active-account, 1000 chars, plain text); `GET /thoughts/fresh` (createdAt cursor) + `GET /thoughts/for-you` (deterministic scoring: freshness decay + interests + Toli + log-engagement, weights in `thoughts-ranking.service.ts`, author-diversity interleave) + `GET /thoughts/:id`; like/unlike, share (idempotent), hide/unhide, report (`ReportReason`), comments (`POST`/`GET`, 500 chars). Feeds exclude banned/deleted authors, both-direction blocks, own hides/reports. Events recorded fail-open (`open/like/comment/share/hide/report`, batched `createMany` impressions capped at 20); `profile_open` recorded on public-profile reads (`connection_request` follows with Phase 6 notification wiring).
- **Frontend**: `Thoughts`/`Thought`/`ThoughtComments` tags + full RTK set; `/thoughts` feed (For You/Fresh tabs, composer, cards with like/comment/share/hide/report + undo, load-more) and `/thoughts/:id` thread (detail + comments); guests see `LockedPanel`.
- Verify: backend `lint`/`build` pass, `test --runInBand` **24/24, 121/121** (11 new: ranking + service); frontend `typecheck`/`lint`/`build` pass.

### Phase 6 — Notifications (2026-09-15)
- **Central service** (`NotificationsModule`): single `notifications` writer with typed fail-open helpers for exactly the four Launch-1 types (`connection_request`, `connection_accepted`, `new_dm`, `legal_notice`). No Thought/Toli/marketing types exist.
- **Wiring**: connection request (notify receiver + `connection_request` ranking event) and accept (notify requester with conversation id) in `ConnectionsService`; new-DM fan-out (sender name + 80-char preview) in `DirectMessagesService`; `POST /admin/legal-notices {userId, title, body}` with moderation-action audit in `AdminService`.
- **API**: `GET /notifications` (cursor page + `unreadCount`), `POST /notifications/:id/read` (ownership-checked), `POST /notifications/read {conversationId?}` (JSON-path scoped).
- **Frontend**: `Notifications` tag + RTK set; bell with unread badge in desktop/mobile nav (30s polling); `/notifications` page (mark read/all, deep links per type); DM thread clears its conversation notifications on open and while reading.
- Verify: backend `lint`/`build` pass, `test --runInBand` **25/25, 128/128** (7 new: service, connections/DM/admin wiring); frontend `typecheck`/`lint`/`build` pass.

### Phase 7 — Worker (2026-09-15)
- **Bootstrap**: worker runs consumers with `enableShutdownHooks`; api/realtime/worker all shut down gracefully (finish work → close Redis/DB). Moderation + image worker modules stay intentionally empty (sync checks; uploads deferred) with reasons recorded in code.
- **Jobs** (BullMQ, attempts + exponential backoff, completion/failure retention caps, `@OnWorkerEvent('failed')` logging): `NOTIFICATION_CREATE` (attempts 5), `THOUGHT_EVENT_PROCESS` (attempts 3), `SESSION_CLEANUP` (every 6h via `upsertJobScheduler`, deletes expired + >7d-revoked sessions).
- **Producers**: connection/DM notifications and thought-impression batches enqueue with synchronous fallback when Redis is down; action events stay synchronous; legal notices stay synchronous for audit. API app owns producers only, worker owns consumers.
- Verify: backend `lint`/`build` pass, `test --runInBand` **28/28, 140/140** (12 new: enqueue/fallback, 3 processors); frontend untouched.

### Phase 8 — Cross-feature integration (2026-09-15)
- **One identity card** (`src/common/profile-card.ts`): channel/DM/connection/block/search senders now return HiRotoli `displayName` + resolved `profilePicture {type, avatarUrl, toliAvatarKey}` + `toli`. No OAuth names, no character config on any social surface (audited).
- **Frontend**: `UserSummary`/connection/search/DM types carry picture + Toli; new `SenderAvatar` (Toli key → catalog swatch, else provider URL) and `ToliAvatar` used in chat, DMs, connections, search, Thoughts, profile header, and user menu; `ToliBadge` on chat names, DM threads/lists, connections, comments, profiles. Home renders the user's own 3D config plus a My Toli card with room entry.
- Verify: backend `lint`/`build` pass, `test --runInBand` **28/28, 142/142** (2 new: channel/DM identity cards); frontend `typecheck`/`lint`/`build` pass.

### Dev-env fix — shared-dist watch race (2026-09-15)
- Symptom: `nest start --watch` (realtime/worker) compiled with 0 errors but crashed at boot with `MODULE_NOT_FOUND` (`./notifications.service`, `./health/health.controller`). `dist/` kept receiving emits after the crash (timestamps prove node booted against a half-written tree).
- Cause: concurrent watchers share one `dist/` + one `tsconfig.build.tsbuildinfo` (`incremental: true`); one watcher's emit invalidated the other's, and node booted mid-write.
- Fix: removed `"incremental": true` from `tsconfig.json` (watch stays incremental in memory; only cold-start reuse is lost), deleted `dist/`, rebuilt. Both apps smoke-booted clean afterwards.
- Watch items: local Redis flapped (`ECONNREFUSED 127.0.0.1:6379` during one boot, fine the next) — make sure it is up before devving; BullMQ warns the Redis eviction policy is `volatile-lru`, production must use `noeviction`.

### Dev-env fix 2 — realtime BullMQ had no shared config (2026-09-15)
- Symptom: realtime logs showed `ECONNREFUSED 127.0.0.1:6379` even though `.env` holds a valid hosted `REDIS_URL` (verified file, dotenv parsing, and single occurrence — all clean).
- Cause: `RealtimeAppModule → DirectMessageGatewayModule → DirectMessagesModule → NotificationsModule → BullModule.registerQueue('notifications')` with no `BullModule.forRoot` in the realtime app, so that queue defaulted to `localhost:6379`. (The stray `BullModule dependencies initialized` lines in the realtime boot log were the fingerprint.)
- Fix: added the same `BullModule.forRootAsync` (`redis.url`) to `RealtimeAppModule`. All three apps now source every Redis client (Bull, `RedisService`, Socket.IO adapter) from `REDIS_URL`; no credentials hardcoded. Realtime reboot shows zero localhost dials and connects to the hosted instance.

### Dev-env fix 3 — per-app dev output dirs (2026-09-15)
- Symptom (again): a realtime watcher reported 0 errors then crashed on `Cannot find module '../../config/app.config'` — `dist/` had been wiped mid-boot by a concurrently starting sibling watcher (`nest start` runs `deleteOutDir` on every start, including `--watch`; two api watchers were even running at once due to `npm run start:dev realtime` forwarding a stray arg).
- Fix: `tsconfig.api|realtime|worker.json` (extend shared build config, own `outDir` under `dist/`) + dev scripts now pass `--path`. Prod `nest build`/`nest start` layout (`dist/`) is untouched. Verified: realtime startup no longer touches `dist/api` (mtime-identical), both apps boot clean.
- Action needed in your terminals: stop all backend watchers/node processes once, then start exactly one of each with `npm.cmd run start:dev`, `start:dev:realtime`, `start:dev:worker` (never `npm run start:dev <app>` — extra args get forwarded and spawn duplicates). The stale shared `dist/src` tree can be deleted once nothing uses it.
