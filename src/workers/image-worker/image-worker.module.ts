import { Module } from '@nestjs/common';

// Intentionally empty for Launch 1: custom profile image upload and
// processing workers are explicitly deferred (fixed Toli avatars are
// frontend static assets; provider avatars sync by URL).
@Module({})
export class ImageWorkerModule {}
