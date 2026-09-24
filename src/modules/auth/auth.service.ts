import {
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { RedisService } from '@app/core/redis/redis.service';
import { Prisma } from '@prisma/client';
import { SessionService, SessionContext } from '@app/core/session/session.service';
import {
  AccessTokenPayload,
  AuthenticatedUser,
} from './auth.types';

// Short-TTL cache for access-token session verification. Measured in prod:
// JWT verify 1-4ms, Redis GET ~243-269ms (Redis Cloud us-east-1 from local),
// Neon DB PK lookup 487-3100ms. Auth was the dominant tax on every protected
// endpoint. L1 (in-process, 30s) drops hot-path to ~0ms; L2 (Redis, 60s,
// sliding for active users) drops to ~250ms vs 1-3s DB.
// TTL bounds revocation/ban window: logout/refresh explicitly delete L1+L2
// (immediate), bans delete via AdminService plus refresh-path DB check blocks
// new tokens, so worst case a banned session remains usable for up to L1 TTL
// (30s) if ban lands in another process (api vs realtime have separate L1),
// else immediate. Vs 15m for pure-JWT with no DB check.
const AUTH_SESSION_CACHE_PREFIX = 'auth:session:';
const AUTH_SESSION_CACHE_TTL_SECONDS = 60;
const AUTH_L1_TTL_MS = 30_000;

type CachedSessionAuth = {
  userId: string;
  status: string;
  role: string;
  expiresAt: string;
};

type L1Entry = {
  auth: AuthenticatedUser;
  sessionExpiresAt: Date;
  cachedAt: number;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // L1: single-process only. Shared invalidation across api/realtime processes
  // goes via Redis DEL; cross-process L1 staleness window = AUTH_L1_TTL_MS.
  private readonly l1 = new Map<string, L1Entry>();
  // Deduplicate concurrent verifications for the same session (thundering
  // herd on cache miss: 4 parallel polls would otherwise do 4 DB lookups).
  private readonly inflight = new Map<string, Promise<AuthenticatedUser>>();

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    @Optional()
    private readonly redis?: RedisService,
  ) {}

  async refresh(refreshToken: string, context: SessionContext) {
    if (!refreshToken) {
      throw new UnauthorizedException('REFRESH_TOKEN_REQUIRED');
    }

    const sessionId = this.decodeRefreshSessionId(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        user: {
          include: {
            profile: true,
          },
        },
      },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('SESSION_EXPIRED');
    }

    const isValid = await argon2.verify(
      session.refreshTokenHash,
      refreshToken,
    );

    if (!isValid) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    if (
      session.user.status === 'banned' ||
      session.user.status === 'deleted'
    ) {
      throw new ForbiddenException('ACCOUNT_NOT_ALLOWED');
    }

    // Atomic single-use rotation: only one concurrent request holding the
    // same refresh token may revoke it. The loser sees count 0 and is
    // rejected instead of minting a second session.
    const revoked = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revoked.count === 0) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    // Old session is revoked: drop any cached auth so the old access token
    // fails closed on next use (DB would also reject, but cache would hide it
    // for up to TTL).
    await this.invalidateSessionCache(session.id);

    const tokens = await this.sessionService.createSession(
      session.userId,
      context,
      {
        status: session.user.status,
        role: session.user.role,
      },
    );

    return {
      user: session.user,
      ...tokens,
    };
  }

  async logout(refreshToken?: string) {
    if (!refreshToken) {
      return;
    }

    let sessionId: string;
    try {
      sessionId = this.decodeRefreshSessionId(refreshToken);
    } catch {
      return;
    }

    await this.prisma.session
      .update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      })
      .catch((error) => {
        this.logger.error(
          `Failed to revoke session ${sessionId} during logout`,
          error instanceof Error ? error.stack : undefined,
        );
      });

    // Immediate revocation for cached verifiers; DB already revoked above.
    await this.invalidateSessionCache(sessionId);
  }

  async getMe(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
      },
    });
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    const totalStart = Date.now();
    try {
      const jwtStart = Date.now();
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.jwtAccessSecret'),
        issuer:
          this.config.get<string>('auth.jwtIssuer') ?? 'hirotoli-api',
        audience:
          this.config.get<string>('auth.jwtAudience') ?? 'hirotoli-client',
      });
      const jwtMs = Date.now() - jwtStart;

      // L1 fast path: in-process (0ms). Sliding expiry for active users.
      const l1Hit = this.readL1(payload.sessionId);
      if (l1Hit) {
        if (
          l1Hit.status === 'banned' ||
          (l1Hit.status as string) === 'deleted'
        ) {
          throw new ForbiddenException('ACCOUNT_NOT_ALLOWED');
        }
        this.logger.debug(
          `verifyAccessToken total=${(Date.now() - totalStart).toFixed(1)}ms jwt=${jwtMs.toFixed(1)}ms cache=l1-hit`,
        );
        return l1Hit;
      }

      // Deduplicate concurrent verifications for the same session.
      const existing = this.inflight.get(payload.sessionId);
      if (existing) {
        const shared = await existing;
        this.logger.debug(
          `verifyAccessToken total=${(Date.now() - totalStart).toFixed(1)}ms jwt=${jwtMs.toFixed(1)}ms cache=shared-inflight`,
        );
        return shared;
      }

      const verifyPromise = this.verifyUncached(payload, jwtMs, totalStart);
      this.inflight.set(payload.sessionId, verifyPromise);
      try {
        return await verifyPromise;
      } finally {
        this.inflight.delete(payload.sessionId);
      }
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      this.logger.error(
        'Access token verification failed',
        error instanceof Error ? error.stack : undefined,
      );
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
  }

  private async verifyUncached(
    payload: AccessTokenPayload,
    jwtMs: number,
    totalStart: number,
  ): Promise<AuthenticatedUser> {
    // L2: Redis-cached session auth (60s TTL, sliding). Fail-open to DB on
    // Redis miss/error so auth never breaks because cache is down.
    const redisStart = Date.now();
    const cached = await this.readSessionCache(payload.sessionId);
    const redisMs = Date.now() - redisStart;
    if (cached) {
      if (cached.expiresAt <= new Date()) {
        throw new UnauthorizedException('SESSION_EXPIRED');
      }
      if (cached.status === 'banned' || cached.status === 'deleted') {
        throw new ForbiddenException('ACCOUNT_NOT_ALLOWED');
      }
      const auth: AuthenticatedUser = {
        id: cached.userId,
        status: cached.status as AuthenticatedUser['status'],
        role: cached.role as AuthenticatedUser['role'],
      };
      this.writeL1(payload.sessionId, auth, cached.expiresAt);
      // Sliding TTL for active users, in background (never blocks auth).
      void this.refreshSessionCacheTtl(payload.sessionId).catch(
        () => undefined,
      );
      this.logger.debug(
        `verifyAccessToken total=${(Date.now() - totalStart).toFixed(1)}ms jwt=${jwtMs.toFixed(1)}ms cache=l2-hit redis=${redisMs.toFixed(1)}ms`,
      );
      return auth;
    }

    // Slow path: minimal-column PK lookup (was include:{user:true}).
    // Pure-JWT with no DB check was rejected: it would open a 15m
    // revocation/ban window. L1+L2+DB keeps worst case to 30s cross-process
    // (L1) / 60s idle (L2) for status changes without explicit invalidation,
    // 0s for logout/refresh/ban+revoke via explicit DEL, while removing the
    // 500-3100ms Neon tax on cache hits.
    const dbStart = Date.now();
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sessionId },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { id: true, status: true, role: true } },
      },
    });
    const dbMs = Date.now() - dbStart;

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('SESSION_EXPIRED');
    }

    if (
      session.user.status === 'banned' ||
      session.user.status === 'deleted'
    ) {
      throw new ForbiddenException('ACCOUNT_NOT_ALLOWED');
    }

    const auth: AuthenticatedUser = {
      id: payload.id,
      status: session.user.status,
      role: session.user.role,
    };
    // L1 synchronously (next sequential request hits even before Redis
    // write completes); L2 in background to avoid adding ~250ms write
    // latency to the miss path.
    this.writeL1(payload.sessionId, auth, session.expiresAt);
    void this.writeSessionCache(session.id, {
      userId: session.user.id,
      status: session.user.status,
      role: session.user.role,
      expiresAt: session.expiresAt.toISOString(),
    }).catch(() => undefined);

    this.logger.debug(
      `verifyAccessToken total=${(Date.now() - totalStart).toFixed(1)}ms jwt=${jwtMs.toFixed(1)}ms cache=miss redis=${redisMs.toFixed(1)}ms db=${dbMs.toFixed(1)}ms`,
    );

    return auth;
  }

  /** Delete cached auth for one session. Fail-open: cache errors never throw. */
  async invalidateSessionCache(sessionId: string): Promise<void> {
    this.l1.delete(sessionId);
    this.inflight.delete(sessionId);
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.connection.del(
        `${AUTH_SESSION_CACHE_PREFIX}${sessionId}`,
      );
    } catch (error) {
      this.logger.debug(
        `Auth session cache invalidation skipped: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /**
   * Delete cached auth for all active sessions of a user (ban/delete).
   * Admin path is rare, so one extra DB query to resolve session IDs is
   * acceptable to keep the ban window at ~0 instead of TTL.
   */
  async invalidateUserSessionsCache(userId: string): Promise<void> {
    if (!this.redis) {
      // Still clear any L1 entries for this user (single-process best effort).
      for (const [sessionId, entry] of this.l1) {
        if (entry.auth.id === userId) {
          this.l1.delete(sessionId);
          this.inflight.delete(sessionId);
        }
      }
      return;
    }
    try {
      const sessions = await this.prisma.session.findMany({
        where: { userId },
        select: { id: true },
      });
      for (const s of sessions) {
        this.l1.delete(s.id);
        this.inflight.delete(s.id);
      }
      if (sessions.length === 0) {
        return;
      }
      await this.redis.connection.del(
        ...sessions.map((s) => `${AUTH_SESSION_CACHE_PREFIX}${s.id}`),
      );
    } catch (error) {
      this.logger.debug(
        `Auth user sessions cache invalidation skipped: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private readL1(sessionId: string): AuthenticatedUser | null {
    const entry = this.l1.get(sessionId);
    if (!entry) {
      return null;
    }
    if (
      Date.now() - entry.cachedAt > AUTH_L1_TTL_MS ||
      entry.sessionExpiresAt <= new Date()
    ) {
      this.l1.delete(sessionId);
      return null;
    }
    return entry.auth;
  }

  private writeL1(
    sessionId: string,
    auth: AuthenticatedUser,
    sessionExpiresAt: Date,
  ): void {
    // Bound memory: simple FIFO eviction past 5k entries (per process).
    if (this.l1.size >= 5000) {
      const oldest = this.l1.keys().next();
      if (!oldest.done) {
        this.l1.delete(oldest.value);
      }
    }
    this.l1.set(sessionId, {
      auth,
      sessionExpiresAt,
      cachedAt: Date.now(),
    });
  }

  private async readSessionCache(
    sessionId: string,
  ): Promise<(Omit<CachedSessionAuth, 'expiresAt'> & { expiresAt: Date }) | null> {
    if (!this.redis) {
      return null;
    }
    try {
      const raw = await this.redis.connection.get(
        `${AUTH_SESSION_CACHE_PREFIX}${sessionId}`,
      );
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as CachedSessionAuth;
      if (!parsed.userId || !parsed.status || !parsed.role || !parsed.expiresAt) {
        return null;
      }
      return { ...parsed, expiresAt: new Date(parsed.expiresAt) };
    } catch (error) {
      this.logger.debug(
        `Auth session cache read skipped: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  private async writeSessionCache(
    sessionId: string,
    value: CachedSessionAuth,
  ): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.connection.set(
        `${AUTH_SESSION_CACHE_PREFIX}${sessionId}`,
        JSON.stringify(value),
        'EX',
        AUTH_SESSION_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.debug(
        `Auth session cache write skipped: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async refreshSessionCacheTtl(sessionId: string): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.connection.expire(
        `${AUTH_SESSION_CACHE_PREFIX}${sessionId}`,
        AUTH_SESSION_CACHE_TTL_SECONDS,
      );
    } catch {
      // Sliding TTL is best-effort only.
    }
  }

  private decodeRefreshSessionId(refreshToken: string): string {
    const parts = refreshToken.split('.');

    if (parts.length !== 2) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    const [sessionId, secret] = parts;

    if (
      !sessionId ||
      !secret ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        sessionId,
      ) ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(secret)
    ) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    return sessionId;
  }

  private async createUniqueUsername(
    tx: Prisma.TransactionClient,
    displayName: string,
  ): Promise<string> {
    const base = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 20) || 'user';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const username =
        attempt === 0
          ? `${base}_${randomBytes(3).toString('hex')}`
          : `${base}_${randomBytes(5).toString('hex')}`;

      const existing = await tx.profile.findUnique({
        where: { username },
      });

      if (!existing) {
        return username;
      }
    }

    return `user_${randomBytes(8).toString('hex')}`;
  }
}
