# AGENTS.md — social-chat-backend

NestJS monorepo (API + Realtime + Worker) for Social Chat App V1.

## Structure
- `src/apps/api|realtime|worker/main.ts` — entry points (see `nest-cli.json`)
- `src/modules/` — feature modules (auth, profiles, channels, etc.)
- `src/common/` `src/core/` `src/config/` — shared code, guards, config
- `src/realtime/` `src/workers/` — gateways, BullMQ jobs
- `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.ts`
- `test/jest-e2e.json` — e2e config; unit tests colocated as `*.spec.ts`

Path alias: `@app/*` -> `src/*` (`tsconfig.json`, `jest.config.js`).

## Setup
1. Copy `.env.example` to `.env`, fill secrets. Never commit `.env`.
2. Start PostgreSQL + Redis (`DATABASE_URL`, `REDIS_URL` in `.env.example`).
3. Install / migrate / run (Windows PowerShell: use `npm.cmd` if `npm` is blocked):
```bash
npm.cmd install
npm.cmd run prisma:generate
npm.cmd run prisma:migrate
npm.cmd run start:api:dev
```
Separate processes:
```bash
npm.cmd run start:api:dev
npm.cmd run start:realtime:dev
npm.cmd run start:worker:dev
```

## Commands
- Build: `npm.cmd run build`
- Lint (zero warnings): `npm.cmd run lint`
- Format: `npm.cmd run format`
- Unit: `npm.cmd run test` / `test:watch`
- E2E: `npm.cmd run test:e2e`
- Prisma: `prisma:generate`, `prisma:migrate`, `prisma:deploy`, `prisma:studio`

## Conventions
- TypeScript strict (`strict`, `noImplicitAny`). Target ES2022, CommonJS, decorators enabled.
- NestJS modules + `class-validator`/`class-transformer` DTOs. No `any` without justification.
- ESLint `@typescript-eslint/recommended` + prettier. Prefix unused args/vars with `_`.
- Keep `api`/`realtime`/`worker` boundaries clean; shared logic goes in `common/` or `core/`.
- Prisma is source of truth for DB. Add migration for schema changes; update `seed.ts` if needed.
- Auth: JWT access+refresh, argon2 hashing. Don't log secrets/tokens/PII.
- Ports: `PORT` (api), `REALTIME_PORT`, `WORKER_PORT`.
