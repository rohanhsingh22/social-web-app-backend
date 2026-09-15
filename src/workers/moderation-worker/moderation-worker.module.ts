import { Module } from '@nestjs/common';

// Intentionally empty for Launch 1: moderation checks (spam, banned words)
// run synchronously inside the request/realtime path via ModerationService.
// A worker is only warranted if a genuinely asynchronous moderation workload
// appears (e.g. bulk re-scans); do not add jobs here speculatively.
@Module({})
export class ModerationWorkerModule {}
