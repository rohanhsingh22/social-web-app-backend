const parseOrigins = (value?: string): string[] => {
  if (!value) {
    return ['http://localhost:3000'];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

export const appConfig = () => ({
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
  auth: {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
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
  logging: {
    level: process.env.LOG_LEVEL ?? 'log',
  },
});
