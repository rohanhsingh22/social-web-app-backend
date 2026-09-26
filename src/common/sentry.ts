import * as Sentry from '@sentry/nestjs';

// No-op unless SENTRY_DSN is set. Called first in every app main so even
// bootstrap failures are captured.
export function initSentry(app: string): void {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    serverName: app,
  });
}
