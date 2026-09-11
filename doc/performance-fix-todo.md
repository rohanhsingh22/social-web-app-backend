# API Performance Fix Todo

Goal: reduce the initial guest and authenticated app load to approximately 1-2 seconds without moving the database region.

## Completed In This Pass

- [x] Change frontend auth bootstrap to refresh once and reuse the returned user/session.
- [x] Stop forcing refresh before every API request; refresh only for protected requests after a 401.
- [x] Remove the home-page `/channels/default` request when `/channels` already contains the default channel.
- [x] Frontend production build passes.

## In Progress

- [ ] Add targeted tests for guest startup, authenticated startup, refresh failure, and 401 retry behavior.

## Backend Follow-up

- [ ] Measure refresh phases and protected-request database timings.
- [ ] Decide whether a bootstrap endpoint is needed after the frontend waterfall is removed.
- [x] Add low-TTL channel metadata caching with explicit invalidation if measurements justify it.
- [x] Add short public HTTP cache headers for channel metadata and message history.
- [x] Add a Redis-backed latest-message cache shared by API instances.
- [x] Warm the default channel metadata and latest messages before the API accepts traffic.
- [x] Fix Redis startup connection-state handling so warmup does not race Redis readiness.
- [ ] Verify Prisma pool settings for the current Neon pooled connection.
- [x] Measure cold message-query behavior before adding a custom bootstrap query.

## Deferred

- Database-region migration is intentionally deferred.
- Do not weaken refresh-token hashing or session revocation checks without benchmark and security review.

## Verification

- [x] Guest first load no longer forces `/auth/refresh` before public channel requests in the base query.
- [x] Authenticated bootstrap can use `/auth/refresh` directly and reuse its returned user instead of requiring `/auth/me`.
- [x] Home page no longer requests `/channels/default` when the channel list is available.
- [x] Frontend production build passes.
- [x] Frontend lint has no errors; three warnings remain in unrelated pre-existing files.
- [x] Live API check with temporary port `3010`: refresh without cookies `407ms`, cold `/channels` `1134ms`, first messages `2011ms`, warm messages `1069ms`, warm `/channels` `34ms`.
- [x] Additional check showed cold messages are slow even with `limit=1` (`2778ms`) and warm at `912ms`, proving the remaining cold delay is database wake/connect latency rather than response size.
- [x] Runtime headers verified: channel metadata uses `max-age=10`, message history uses `max-age=1`.
- [x] API startup warmup verified on temporary port `3013`: `/channels` `154ms`, first warmed messages `402ms`, repeat messages `496ms`.
- [ ] Verify the complete request waterfall in the browser with the API running.
- [x] Backend build/lint/unit tests pass; full unit suite is `42/42`.

## Notes

- The database region remains unchanged. The first cold database query can still be slow after an idle period, so the API now pays that wake-up cost during startup and serves the warmed default page from Redis afterward.
- Redis caching is fail-open: if Redis is unavailable, requests continue to use Prisma and the API still starts.
