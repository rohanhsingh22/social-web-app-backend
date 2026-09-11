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
- User search returns safe public profile fields, excludes blocked relationships, and includes viewer-relative connection status.
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
