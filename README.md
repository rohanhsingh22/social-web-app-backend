# Social Chat Backend

NestJS backend scaffold for the Social Chat App V1.

## Apps

- API app: HTTP auth, profiles, channels, connections, reports, blocks, admin APIs.
- Realtime app: Socket.IO channel and DM gateways.
- Worker app: BullMQ-backed background jobs.

## Local setup

1. Copy `.env.example` to `.env` and fill in secrets.
2. Start PostgreSQL and Redis.
3. Install dependencies with `npm.cmd install` on Windows PowerShell if `npm` is blocked.
4. Run `npm.cmd run prisma:generate`.
5. Run `npm.cmd run prisma:migrate`.
6. Start the API with `npm.cmd run start:api:dev`.

Separate processes:

```bash
npm.cmd run start:api:dev
npm.cmd run start:realtime:dev
npm.cmd run start:worker:dev
```
