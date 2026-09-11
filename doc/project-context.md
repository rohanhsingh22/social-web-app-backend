# Project Context

Last reviewed: 2026-09-10

This file is a quick working index for future changes. The product requirements remain in `frontend-chat-app.txt` and `backend-chat-app.txt`.

## Repository Scope

This repository is the backend only. The frontend specification describes a separate mobile-first web client; no Next.js frontend is present here.

## Architecture

- NestJS modular monolith with three deployable apps:
  - API: HTTP auth, profiles, channels, connections, reports, blocks, admin, settings.
  - Realtime: Socket.IO channel and direct-message gateways, presence, Redis adapter/rate limiting.
  - Worker: BullMQ worker entry point with worker module placeholders.
- PostgreSQL and Prisma are the persistence layer.
- Redis is used for realtime coordination, presence, and rate limiting.
- Path alias: `@app/*` maps to `src/*`.
- Main entry points: `src/apps/api/main.ts`, `src/apps/realtime/main.ts`, `src/apps/worker/main.ts`.

## Current Implementation Map

Implemented or substantially present:

- Facebook/provider integration and JWT access/refresh sessions.
- Auth guard, current-user decorator, refresh, logout, and `auth/me`.
- Profiles read/update and profile completion fields.
- Public channel listing, default channel lookup, channel lookup, and message history.
- Realtime channel join/leave/send, authentication, presence, Redis rate limiting, and tests.
- Authenticated connections APIs and user search with Redis-backed rate limits.
- Direct-message HTTP conversation/message reads and realtime sends.
- Reports, blocks, admin moderation actions, banned words, and moderation audit logs.
- User settings, theme/accent configuration, and related Prisma migrations.
- Prisma schema and seed data for the core social-chat entities.
- Health endpoint, exception handling, request logging, CORS, Helmet, and app configuration.

Present but incomplete or currently stub-oriented:

- Uploads and background worker processors need completion if they are required for launch.
- Phase 9 still needs real infrastructure validation: load tests, monitoring wiring, deployment pipeline, and a 5k socket run.
- E2E coverage is not established; current tests are primarily unit tests.

## Important Product Rules

- Guests can read public channels but cannot send messages or access private features.
- Facebook and Google are the supported V1 login providers.
- Direct messages require an accepted connection.
- Blocked, muted, and banned users must be enforced by backend authorization and realtime checks.
- Public profiles must not expose email, phone, provider IDs, exact DOB, or login metadata.
- V1 excludes group DMs, replies/threads, attachments, voice/video, user-created channels, payments, ads, and recommendation systems.

## Data Model

Core Prisma models include users, auth identities, sessions, profiles, settings, channels, channel messages, connections, conversations, direct messages, reports, blocks, moderation actions, and banned words. Migrations currently include the initial schema plus character configuration, user settings, and accent color changes.

## Local Commands

Use Windows PowerShell commands from `AGENTS.md`:

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd run test
npm.cmd run test:e2e
```

Normal local services require PostgreSQL and Redis configured through `.env`. Never commit `.env` or expose its credentials. `doc/temporary-changes.md` records the current Neon connection-limit workaround and cleanup steps before production.

## Working Notes

- Read `progress.md` for the current implementation history and endpoint smoke-test notes.
- Keep API, realtime, and worker boundaries clean; put shared behavior in `src/common` or `src/core`.
- Prisma schema changes require a migration.
- Existing working-tree changes belong to the user and must be preserved.

## Baseline Verification

- `npm.cmd run build`: passes.
- `npm.cmd run lint`: passes with zero warnings.
- `npm.cmd run test -- --runInBand`: passes.
