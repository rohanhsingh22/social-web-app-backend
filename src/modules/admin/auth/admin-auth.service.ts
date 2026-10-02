import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { StringValue } from 'ms';
import { UserRole } from '@prisma/client';
import { PrismaService } from '@app/core/prisma/prisma.service';
import { SessionContext } from '@app/core/session/session.service';
import { OAuthStateService } from '@app/modules/integration/oauth-state.service';
import { ProviderRegistry } from '@app/modules/integration/providers/provider.registry';
import { AdminAuditService } from './admin-audit.service';
import { ADMIN_JWT_AUDIENCE } from './admin-auth.guard';
import {
  isStaffRole,
  permissionsForRole,
} from './admin-permissions';
import { TotpService } from './totp.service';

const ADMIN_OAUTH_STATE_ID = 'google:admin';
const MFA_PENDING_AUDIENCE = 'hirotoli-admin-pending';

export type AdminSessionTokens = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresAt: Date;
};

type PendingTokenPayload = {
  sub: string;
  needsSetup: boolean;
};

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly totp: TotpService,
    private readonly audit: AdminAuditService,
    private readonly oauthState: OAuthStateService,
    private readonly providers: ProviderRegistry,
  ) {}

  // ---- OAuth entry ----

  async getLoginUrl(): Promise<string> {
    const provider = this.providers.getProvider('google');
    const state = await this.oauthState.createState(ADMIN_OAUTH_STATE_ID);
    const callbackUrl = this.config.getOrThrow<string>(
      'admin.googleCallbackUrl',
    );
    return provider.getLoginUrl(state, callbackUrl);
  }

  async handleCallback(
    code: string | undefined,
    state: string | undefined,
    context: SessionContext,
  ): Promise<{ pendingToken: string; needsSetup: boolean }> {
    if (!code) {
      throw new UnauthorizedException('OAUTH_CODE_REQUIRED');
    }
    await this.oauthState.consumeState(ADMIN_OAUTH_STATE_ID, state);

    const provider = this.providers.getProvider('google');
    const callbackUrl = this.config.getOrThrow<string>(
      'admin.googleCallbackUrl',
    );
    const providerToken = await provider.exchangeCode(code, callbackUrl);
    const profile = await provider.fetchProfile(providerToken);

    // Existing identity only. Admin login never creates users: unknown
    // accounts get the same generic denial as non-staff (no enumeration).
    const identity = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'google',
          providerUserId: profile.providerUserId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            status: true,
            role: true,
            mfaCredential: {
              select: { id: true, lastUsedAt: true },
            },
          },
        },
      },
    });

    const user = identity?.user;
    if (!user || user.status !== 'active' || !isStaffRole(user.role)) {
      this.logger.warn(
        `Denied admin OAuth login for provider user ${profile.providerUserId}`,
      );
      throw new ForbiddenException('ADMIN_ACCESS_DENIED');
    }

    await this.prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch(() => undefined);

    const needsSetup = !user.mfaCredential?.lastUsedAt;
    const pendingToken = await this.signPendingToken(user.id, needsSetup);
    this.logger.log(
      `Admin OAuth verified for ${user.id} (${user.role}), mfaSetup=${needsSetup} ip=${context.ipAddress ?? 'unknown'}`,
    );
    return { pendingToken, needsSetup };
  }

  // ---- MFA ----

  async setupTotp(
    userId: string,
  ): Promise<{ otpauthUri: string; secret: string; recoveryCodes: string[] }> {
    const credential = await this.prisma.adminMfaCredential.findUnique({
      where: { userId },
    });
    if (credential?.lastUsedAt) {
      throw new ConflictException('MFA_ALREADY_ENROLLED');
    }

    const { raw, base32 } = this.totp.generateSecret();
    const recoveryCodes = this.totp.generateRecoveryCodes();
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { displayName: true },
    });

    await this.prisma.$transaction(async (tx) => {
      if (credential) {
        await tx.adminRecoveryCode.deleteMany({ where: { userId } });
        await tx.adminMfaCredential.delete({ where: { userId } });
      }
      await tx.adminMfaCredential.create({
        data: { userId, type: 'totp', secretEncrypted: this.totp.encryptSecret(raw) },
      });
      for (const code of recoveryCodes) {
        await tx.adminRecoveryCode.create({
          data: { userId, codeHash: await argon2.hash(code) },
        });
      }
    });

    await this.audit.log({ actorId: userId, action: 'mfa.setup_started' });
    return {
      otpauthUri: this.totp.otpauthUri(base32, profile?.displayName ?? userId),
      // Shown once. Never logged or persisted in plaintext.
      secret: base32,
      recoveryCodes,
    };
  }

  async verifyEnroll(
    userId: string,
    code: string,
    context: SessionContext,
  ): Promise<AdminSessionTokens> {
    const credential = await this.prisma.adminMfaCredential.findUnique({
      where: { userId },
    });
    if (!credential) {
      throw new BadRequestException('MFA_SETUP_REQUIRED');
    }
    if (credential.lastUsedAt) {
      throw new ConflictException('MFA_ALREADY_ENROLLED');
    }

    const secret = this.totp.decryptSecret(credential.secretEncrypted);
    const result = this.totp.verify(secret, code, { lastUsedStep: null });
    if (!result.ok) {
      throw new UnauthorizedException('MFA_CODE_INVALID');
    }

    const user = await this.requireActiveStaff(userId);
    await this.prisma.adminMfaCredential.update({
      where: { userId },
      data: { lastUsedAt: new Date(), lastUsedStep: result.step },
    });
    await this.audit.log({
      actorId: userId,
      actorRole: user.role,
      action: 'mfa.enroll',
    });
    return this.createSession(user.id, user.status, user.role, context, {
      mfaAt: new Date(),
    });
  }

  async verifyChallenge(
    userId: string,
    code: string,
    context: SessionContext,
  ): Promise<AdminSessionTokens> {
    const user = await this.requireActiveStaff(userId);
    const credential = await this.prisma.adminMfaCredential.findUnique({
      where: { userId },
    });
    if (!credential?.lastUsedAt) {
      throw new BadRequestException('MFA_SETUP_REQUIRED');
    }

    const clean = code.replace(/[\s-]/g, '');
    if (/^\d{6}$/.test(clean)) {
      const secret = this.totp.decryptSecret(credential.secretEncrypted);
      const result = this.totp.verify(secret, clean, {
        lastUsedStep: credential.lastUsedStep,
      });
      if (!result.ok) {
        throw new UnauthorizedException('MFA_CODE_INVALID');
      }
      await this.prisma.adminMfaCredential.update({
        where: { userId },
        data: { lastUsedAt: new Date(), lastUsedStep: result.step },
      });
    } else {
      await this.consumeRecoveryCode(userId, code);
    }

    await this.audit.log({
      actorId: userId,
      actorRole: user.role,
      action: 'mfa.verify',
    });
    return this.createSession(user.id, user.status, user.role, context, {
      mfaAt: new Date(),
    });
  }

  async getMfaStatus(userId: string) {
    const [credential, codes] = await Promise.all([
      this.prisma.adminMfaCredential.findUnique({ where: { userId } }),
      this.prisma.adminRecoveryCode.findMany({
        where: { userId, usedAt: null },
        select: { id: true },
      }),
    ]);
    return {
      enrolled: !!credential?.lastUsedAt,
      lastUsedAt: credential?.lastUsedAt ?? null,
      recoveryCodesRemaining: codes.length,
    };
  }

  // ---- Sessions ----

  async refresh(
    refreshToken: string,
    context: SessionContext,
  ): Promise<AdminSessionTokens> {
    if (!refreshToken) {
      throw new UnauthorizedException('ADMIN_REFRESH_REQUIRED');
    }
    const sessionId = this.decodeSessionId(refreshToken);
    const session = await this.prisma.adminSession.findUnique({
      where: { id: sessionId },
      include: {
        user: { select: { id: true, status: true, role: true } },
      },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('ADMIN_SESSION_EXPIRED');
    }
    if (!session.mfaAt) {
      throw new UnauthorizedException('ADMIN_MFA_REQUIRED');
    }
    if (!(await argon2.verify(session.tokenHash, refreshToken))) {
      throw new UnauthorizedException('ADMIN_TOKEN_INVALID');
    }
    if (session.user.status !== 'active' || !isStaffRole(session.user.role)) {
      await this.revokeAllSessions(session.userId, 'role-revoked');
      throw new ForbiddenException('ADMIN_ACCESS_REVOKED');
    }

    const idleMinutes = this.config.get<number>('admin.sessionIdleMinutes') ?? 30;
    if (Date.now() - session.lastSeenAt.getTime() > idleMinutes * 60 * 1000) {
      await this.prisma.adminSession
        .update({ where: { id: session.id }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
      throw new UnauthorizedException('ADMIN_SESSION_IDLE');
    }

    // Atomic single-use rotation, mirroring social refresh semantics.
    const revoked = await this.prisma.adminSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      throw new UnauthorizedException('ADMIN_TOKEN_INVALID');
    }

    return this.createSession(
      session.user.id,
      session.user.status,
      session.user.role,
      context,
      { mfaAt: session.mfaAt },
    );
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }
    let sessionId: string;
    try {
      sessionId = this.decodeSessionId(refreshToken);
    } catch {
      return;
    }
    await this.prisma.adminSession
      .updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }

  async me(userId: string, sessionId: string) {
    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: {
            select: { displayName: true, username: true, avatarUrl: true },
          },
          mfaCredential: {
            select: { lastUsedAt: true },
          },
        },
      }),
      this.prisma.adminSession.findUnique({ where: { id: sessionId } }),
    ]);
    if (!user || !isStaffRole(user.role)) {
      throw new ForbiddenException('ADMIN_ACCESS_REVOKED');
    }
    return {
      id: user.id,
      displayName: user.profile?.displayName ?? 'Staff',
      username: user.profile?.username ?? null,
      role: user.role,
      permissions: permissionsForRole(user.role),
      mfaEnrolled: !!user.mfaCredential?.lastUsedAt,
      mfaVerifiedAt: session?.mfaAt ?? null,
      sessionExpiresAt: session?.expiresAt ?? null,
    };
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.adminSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return sessions.map((session) => ({
      id: session.id,
      current: session.id === currentSessionId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastSeenAt: session.lastSeenAt,
      revokedAt: session.revokedAt,
      mfaAt: session.mfaAt,
      ipAddress: session.ipAddress,
      // User agent identifies the device; visible to staff admins only.
      userAgent: session.userAgent,
    }));
  }

  async revokeSession(
    actorId: string,
    actorRole: string,
    sessionId: string,
    currentSessionId: string,
  ) {
    const session = await this.prisma.adminSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (!session) {
      throw new NotFoundException('ADMIN_SESSION_NOT_FOUND');
    }
    if (session.userId !== actorId && actorRole !== UserRole.owner) {
      throw new ForbiddenException('ADMIN_PERMISSION_REQUIRED');
    }
    await this.prisma.adminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({
      actorId,
      actorRole,
      action: 'session.revoke',
      targetType: 'admin_session',
      targetId: sessionId,
      metadata: { targetUserId: session.userId, current: sessionId === currentSessionId },
    });
    return { revoked: true };
  }

  // ---- Staff ----

  async listStaff() {
    const staff = await this.prisma.user.findMany({
      where: { role: { in: [UserRole.owner, UserRole.admin, UserRole.moderator] } },
      include: {
        profile: { select: { displayName: true, username: true } },
        mfaCredential: { select: { lastUsedAt: true } },
        _count: {
          select: {
            adminSessions: {
              where: { revokedAt: null, expiresAt: { gt: new Date() } },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return staff.map((member) => ({
      id: member.id,
      publicUserId: member.publicUserId,
      displayName: member.profile?.displayName ?? 'Staff',
      username: member.profile?.username ?? null,
      role: member.role,
      status: member.status,
      mfaEnrolled: !!member.mfaCredential?.lastUsedAt,
      activeSessions: member._count.adminSessions,
      createdAt: member.createdAt,
    }));
  }

  async createInvitation(
    actorId: string,
    actorRole: string,
    userId: string,
    role: UserRole,
  ) {
    this.requireOwner(actorRole);
    const invitee = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, role: true },
    });
    if (!invitee || invitee.status !== 'active') {
      throw new NotFoundException('INVITEE_NOT_FOUND');
    }
    if (invitee.role !== UserRole.user) {
      throw new ConflictException('INVITEE_ALREADY_STAFF');
    }

    const rawToken = `inv_${randomBytes(32).toString('base64url')}`;
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const ttlHours = this.config.get<number>('admin.inviteTtlHours') ?? 48;

    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.adminInvitation.updateMany({
        where: { userId, revokedAt: null, acceptedAt: null },
        data: { revokedAt: new Date() },
      });
      const created = await tx.adminInvitation.create({
        data: {
          userId,
          role,
          tokenHash,
          invitedBy: actorId,
          expiresAt: new Date(Date.now() + ttlHours * 3600_000),
        },
      });
      await this.audit.log(
        {
          actorId,
          actorRole,
          action: 'staff.invite',
          targetType: 'user',
          targetId: userId,
          metadata: { invitationId: created.id, role },
        },
        tx,
      );
      return created;
    });

    // Raw token is returned once; only the hash is stored.
    return {
      id: invitation.id,
      userId,
      role,
      token: rawToken,
      expiresAt: invitation.expiresAt,
    };
  }

  async listInvitations() {
    const invitations = await this.prisma.adminInvitation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: {
          select: {
            id: true,
            profile: { select: { displayName: true, username: true } },
          },
        },
        inviter: {
          select: {
            id: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    });
    return invitations.map((invitation) => ({
      id: invitation.id,
      userId: invitation.userId,
      inviteeDisplayName: invitation.user.profile?.displayName ?? invitation.userId,
      role: invitation.role,
      invitedBy: invitation.invitedBy,
      inviterDisplayName: invitation.inviter.profile?.displayName ?? invitation.invitedBy,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
      createdAt: invitation.createdAt,
    }));
  }

  async revokeInvitation(actorId: string, actorRole: string, id: string) {
    this.requireOwner(actorRole);
    const invitation = await this.prisma.adminInvitation.findUnique({
      where: { id },
    });
    if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
      throw new NotFoundException('INVITATION_NOT_FOUND');
    }
    await this.prisma.adminInvitation.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({
      actorId,
      actorRole,
      action: 'staff.invite_revoke',
      targetType: 'invitation',
      targetId: id,
      metadata: { userId: invitation.userId },
    });
    return { revoked: true };
  }

  async acceptInvitation(
    userId: string,
    token: string,
    context: SessionContext,
  ) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invitation = await this.prisma.adminInvitation.findUnique({
      where: { tokenHash },
    });
    if (
      !invitation ||
      invitation.revokedAt ||
      invitation.acceptedAt ||
      invitation.expiresAt <= new Date()
    ) {
      throw new NotFoundException('INVITATION_INVALID');
    }
    if (invitation.userId !== userId) {
      throw new ForbiddenException('INVITATION_NOT_FOR_USER');
    }

    const invitee = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        role: true,
        mfaCredential: { select: { lastUsedAt: true } },
      },
    });
    if (!invitee || invitee.status !== 'active' || invitee.role !== UserRole.user) {
      throw new ConflictException('INVITEE_NO_LONGER_ELIGIBLE');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { role: invitation.role },
      });
      await tx.adminInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      await tx.adminInvitation.updateMany({
        where: { userId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.adminSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        {
          actorId: userId,
          actorRole: invitation.role,
          action: 'staff.invite_accept',
          targetType: 'user',
          targetId: userId,
          metadata: {
            invitationId: invitation.id,
            role: invitation.role,
            invitedBy: invitation.invitedBy,
            ipAddress: context.ipAddress,
          },
        },
        tx,
      );
    });

    return { role: invitation.role, needsSetup: !invitee.mfaCredential?.lastUsedAt };
  }

  async changeRole(
    actorId: string,
    actorRole: string,
    userId: string,
    role: UserRole | 'user',
  ) {
    this.requireOwner(actorRole);
    if (actorId === userId) {
      // No self-promotion, no self-demotion (last-owner lockout included).
      throw new BadRequestException('CANNOT_CHANGE_OWN_ROLE');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, role: true },
    });
    if (!target) {
      throw new NotFoundException('USER_NOT_FOUND');
    }
    if (target.role === role) {
      return { id: target.id, role: target.role, changed: false };
    }

    if (target.role === UserRole.owner && role !== UserRole.owner) {
      const otherOwners = await this.prisma.user.count({
        where: { role: UserRole.owner, status: 'active', id: { not: userId } },
      });
      if (otherOwners === 0) {
        throw new ConflictException('LAST_OWNER_LOCKOUT');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: userId },
        data: { role: role as UserRole },
        select: { id: true, role: true },
      });
      // Any role change kills privileged sessions everywhere; demoted staff
      // cannot ride out access-token TTL because the guard hits the DB.
      await tx.adminSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.adminInvitation.updateMany({
        where: { userId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        {
          actorId,
          actorRole,
          action: 'staff.role_change',
          targetType: 'user',
          targetId: userId,
          metadata: { before: target.role, after: next.role },
        },
        tx,
      );
      return next;
    });
    return { id: updated.id, role: updated.role, changed: true };
  }

  async resetMfa(actorId: string, actorRole: string, userId: string) {
    this.requireOwner(actorRole);
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, role: true },
    });
    if (!target || !isStaffRole(target.role)) {
      throw new NotFoundException('STAFF_NOT_FOUND');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.adminRecoveryCode.deleteMany({ where: { userId } });
      await tx.adminMfaCredential.deleteMany({ where: { userId } });
      await tx.adminSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        {
          actorId,
          actorRole,
          action: 'staff.mfa_reset',
          targetType: 'user',
          targetId: userId,
        },
        tx,
      );
    });
    return { reset: true };
  }

  async bootstrapOwner(userId: string, approvedBy?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, role: true },
    });
    if (!user) {
      throw new NotFoundException('USER_NOT_FOUND');
    }
    if (user.status !== 'active') {
      throw new BadRequestException('USER_NOT_ACTIVE');
    }
    if (user.role === UserRole.owner) {
      return { id: user.id, role: user.role, changed: false };
    }

    const existingOwners = await this.prisma.user.count({
      where: { role: UserRole.owner, status: 'active' },
    });
    let approver: string | null = null;
    if (existingOwners > 0) {
      if (!approvedBy || approvedBy === userId) {
        throw new BadRequestException('OWNER_APPROVAL_REQUIRED');
      }
      const approverUser = await this.prisma.user.findUnique({
        where: { id: approvedBy },
        select: { id: true, status: true, role: true },
      });
      if (
        !approverUser ||
        approverUser.status !== 'active' ||
        approverUser.role !== UserRole.owner
      ) {
        throw new ForbiddenException('APPROVER_NOT_OWNER');
      }
      approver = approverUser.id;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: userId },
        data: { role: UserRole.owner },
        select: { id: true, role: true },
      });
      await this.audit.log(
        {
          actorId: approver ?? userId,
          actorRole: approver ? UserRole.owner : undefined,
          action: 'staff.bootstrap_owner',
          targetType: 'user',
          targetId: userId,
          metadata: {
            before: user.role,
            after: UserRole.owner,
            firstOwner: existingOwners === 0,
          },
        },
        tx,
      );
      return next;
    });
    this.logger.log(
      `Bootstrapped owner ${userId} (first=${existingOwners === 0})`,
    );
    return { id: updated.id, role: updated.role, changed: true };
  }

  // ---- pending tokens ----

  async verifyPendingToken(token: string | undefined): Promise<PendingTokenPayload> {
    if (!token) {
      throw new UnauthorizedException('ADMIN_AUTH_REQUIRED');
    }
    try {
      const payload = await this.jwt.verifyAsync<PendingTokenPayload & { sub: string }>(
        token,
        {
          secret: this.config.getOrThrow<string>('auth.jwtAccessSecret'),
          issuer: this.config.get<string>('auth.jwtIssuer') ?? 'hirotoli-api',
          audience: MFA_PENDING_AUDIENCE,
        },
      );
      if (!payload.sub) {
        throw new UnauthorizedException('ADMIN_TOKEN_INVALID');
      }
      return { sub: payload.sub, needsSetup: payload.needsSetup };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('ADMIN_TOKEN_INVALID');
    }
  }

  private signPendingToken(userId: string, needsSetup: boolean): Promise<string> {
    const minutes = this.config.get<number>('admin.mfaPendingMinutes') ?? 10;
    return this.jwt.signAsync(
      { sub: userId, needsSetup },
      {
        secret: this.config.getOrThrow<string>('auth.jwtAccessSecret'),
        issuer: this.config.get<string>('auth.jwtIssuer') ?? 'hirotoli-api',
        audience: MFA_PENDING_AUDIENCE,
        expiresIn: `${minutes}m`,
      },
    );
  }

  // ---- internals ----

  private async createSession(
    userId: string,
    status: string,
    role: string,
    context: SessionContext,
    options: { mfaAt: Date },
  ): Promise<AdminSessionTokens> {
    const sessionId = randomUUID();
    const secret = randomBytes(48).toString('base64url');
    const refreshToken = `${sessionId}.${secret}`;
    const absoluteHours = this.config.get<number>('admin.sessionAbsoluteHours') ?? 12;
    const expiresAt = new Date(Date.now() + absoluteHours * 3600_000);

    await this.prisma.adminSession.create({
      data: {
        id: sessionId,
        userId,
        tokenHash: await argon2.hash(refreshToken),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        expiresAt,
        lastSeenAt: new Date(),
        mfaAt: options.mfaAt,
      },
    });

    const ttl = this.config.getOrThrow<StringValue>('admin.accessTokenTtl');
    const accessToken = await this.jwt.signAsync(
      { id: userId, status, role, sessionId, mfa: true },
      {
        secret: this.config.getOrThrow<string>('auth.jwtAccessSecret'),
        issuer: this.config.get<string>('auth.jwtIssuer') ?? 'hirotoli-api',
        audience: ADMIN_JWT_AUDIENCE,
        expiresIn: ttl,
      },
    );

    return { accessToken, refreshToken, sessionId, expiresAt };
  }

  private async requireActiveStaff(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, role: true },
    });
    if (!user || user.status !== 'active' || !isStaffRole(user.role)) {
      throw new ForbiddenException('ADMIN_ACCESS_DENIED');
    }
    return user;
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<void> {
    const normalized = this.totp.normalizeRecoveryCode(code);
    const codes = await this.prisma.adminRecoveryCode.findMany({
      where: { userId, usedAt: null },
    });
    for (const entry of codes) {
      if (await argon2.verify(entry.codeHash, normalized)) {
        const claimed = await this.prisma.adminRecoveryCode.updateMany({
          where: { id: entry.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (claimed.count === 0) {
          break;
        }
        await this.audit.log({ actorId: userId, action: 'mfa.recovery_used' });
        return;
      }
    }
    throw new UnauthorizedException('MFA_CODE_INVALID');
  }

  private async revokeAllSessions(userId: string, reason: string): Promise<void> {
    await this.prisma.adminSession
      .updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
    this.logger.warn(`Revoked all admin sessions for ${userId}: ${reason}`);
  }

  private decodeSessionId(refreshToken: string): string {
    const parts = refreshToken.split('.');
    if (
      parts.length !== 2 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[0]) ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(parts[1])
    ) {
      throw new UnauthorizedException('ADMIN_TOKEN_INVALID');
    }
    return parts[0];
  }

  private requireOwner(role: string) {
    if (role !== UserRole.owner) {
      throw new ForbiddenException('ADMIN_PERMISSION_REQUIRED');
    }
  }
}
