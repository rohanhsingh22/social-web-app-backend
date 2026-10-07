const parseOrigins = (value?: string): string[] => {
  if (!value) {
    return ['http://localhost:3000'];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const parseBoolean = (value?: string, fallback = true): boolean => {
  if (value === undefined || value === '') {
    return fallback;
  }

  return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
};

export const appConfig = () => {
  if (
    (process.env.NODE_ENV ?? 'development') === 'production' &&
    !process.env.JWT_ACCESS_SECRET
  ) {
    throw new Error('JWT_ACCESS_SECRET is required in production');
  }

  return {
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    realtimePort: Number(process.env.REALTIME_PORT ?? 3001),
    workerPort: Number(process.env.WORKER_PORT ?? 3002),
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3000',
    frontendBaseUrl: process.env.FRONTEND_BASE_URL ?? 'http://localhost:3000',
    corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
    cookieDomain: process.env.COOKIE_DOMAIN ?? 'localhost',
  },
  admin: {
    // Canonical admin frontend URL. Post-OAuth redirects are allowlisted to this.
    appBaseUrl: process.env.ADMIN_APP_BASE_URL ?? 'http://localhost:5174',
    // Separate Google OAuth callback for admin login. Must be registered in the
    // Google console alongside the social callback; never reuse the social one.
    googleCallbackUrl:
      process.env.ADMIN_GOOGLE_CALLBACK_URL ??
      'http://localhost:3001/admin/auth/callback/google',
    accessTokenTtl: process.env.ADMIN_ACCESS_TOKEN_TTL ?? '10m',
    // Idle + absolute privileged-session bounds (server-enforced).
    sessionIdleMinutes: Number(process.env.ADMIN_SESSION_IDLE_MINUTES ?? 30),
    sessionAbsoluteHours: Number(process.env.ADMIN_SESSION_ABSOLUTE_HOURS ?? 12),
    mfaPendingMinutes: Number(process.env.ADMIN_MFA_PENDING_MINUTES ?? 10),
    inviteTtlHours: Number(process.env.ADMIN_INVITE_TTL_HOURS ?? 48),
    // AES-256-GCM key (64 hex chars) for TOTP secrets at rest. Missing in
    // production fails closed; development falls back to an ephemeral key.
    mfaEncryptionKey: process.env.ADMIN_MFA_ENCRYPTION_KEY,
  },
  auth: {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtIssuer: process.env.JWT_ISSUER ?? 'hirotoli-api',
    jwtAudience: process.env.JWT_AUDIENCE ?? 'hirotoli-client',
    accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTokenTtl: process.env.REFRESH_TOKEN_TTL ?? '30d',
    facebookAppId: process.env.FACEBOOK_APP_ID,
    facebookAppSecret: process.env.FACEBOOK_APP_SECRET,
    facebookCallbackUrl: process.env.FACEBOOK_CALLBACK_URL,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL,
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  storage: {
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  observability: {
    sentryDsn: process.env.SENTRY_DSN,
  },
  voice: {
    // LiveKit SFU behind the HomeVoiceProvider abstraction. Absent in
    // development/test — token issuance fails closed with VOICE_UNAVAILABLE.
    livekitUrl: process.env.LIVEKIT_URL,
    livekitApiKey: process.env.LIVEKIT_API_KEY,
    livekitApiSecret: process.env.LIVEKIT_API_SECRET,
  },
  home: {
    // Rollout lever (spec #136). Off kills every /home route with
    // HOME_DISABLED without reverting code; percentage stages (if ever
    // needed) build on this single server decision.
    enabled: parseBoolean(process.env.HOME_SOCIAL_VOICE_ENABLED, true),
  },
  logging: {
    level: process.env.LOG_LEVEL ?? 'log',
  },
  retention: {
    // Days to keep channel/DM messages. 0 (default) disables deletion.
    messageRetentionDays: Number(process.env.MESSAGE_RETENTION_DAYS ?? 0),
  },
  };
};
