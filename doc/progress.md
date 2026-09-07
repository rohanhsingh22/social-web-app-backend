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

- Connections (`/connections/*`) — Phase 6.
- User search (`/users/search`) — Phase 6.
- Direct messages (`/dm/*` and `/dm` gateway) — Phase 7.
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

## Validation

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd run test
npm.cmd run test:e2e
```
