# Temporary Changes (revert/cleanup before launch)

Tracking changes made for local development that must be revisited before production.

## 1. Neon connection limit workaround

### What changed
- `.env` — `DATABASE_URL` now has `&connection_limit=1` to avoid Prisma `P2028` (transaction timeout) on Neon's free tier.

### Cleanup before launch
- Replace the direct Neon URL with the proper pooled connection string (`-pooler` host + `pgbouncer=true`), and tune `connection_limit` for the production pool size.
- Remove this line from `.env` once the pooled URL is in place.

## 2. Prisma transaction timeout + connection-pool fix

### What changed
- `src/core/prisma/prisma.service.ts` — added `transactionOptions` (`maxWait: 15s`, `timeout: 30s`) to survive Neon's idle cold-start.
- `src/modules/auth/auth.service.ts` — `createUniqueUsername()` now receives the transaction client (`tx`) and queries `tx.profile` instead of `this.prisma`, so it no longer grabs a second connection while inside a transaction.

### Why
With `connection_limit=1`, the transaction held the only connection, and the inner `this.prisma.profile.findUnique()` deadlocked (`P2024`). The Facebook and dev login paths both now pass `tx` through.

### Cleanup before launch
- Revisit `transactionOptions` values once on the production (pooled) DB; they were raised for Neon free-tier cold starts.
- Keep `tx` usage as-is — it is correct regardless of pool size — but the `connection_limit=1` workaround above is what should be removed with the pooled URL.

## Notes
- Do NOT commit `.env` (already gitignored).
- `.env` currently contains real credentials (Neon, Redis, Facebook App ID/Secret). Rotate them before sharing the repo or going to production.
