import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { envelope } from '@app/common/api-response';
import { AdminAuthService, AdminSessionTokens } from './admin-auth.service';
import {
  AdminAuthGuard,
  AdminAuthenticatedRequest,
} from './admin-auth.guard';
import { AdminPermissionsGuard } from './admin-permissions.guard';
import { RequirePermissions } from './require-permissions.decorator';
import {
  CreateInvitationDto,
  MfaCodeDto,
  MfaResetDto,
  RoleChangeDto,
} from './dto/admin-auth.dto';
import { UserRole } from '@prisma/client';

const REFRESH_COOKIE = 'admin_refresh_token';
const PENDING_COOKIE = 'admin_mfa_pending';

@Controller('admin')
export class AdminAuthController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly config: ConfigService,
  ) {}

  // ---- OAuth entry (public) ----

  @Get('auth/start/google')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async startGoogle(@Res() response: Response) {
    const loginUrl = await this.adminAuth.getLoginUrl();
    return response.redirect(loginUrl);
  }

  @Get('auth/callback/google')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async handleGoogleCallback(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const code = request.query.code as string | undefined;
    const state = request.query.state as string | undefined;
    const adminApp = this.config.getOrThrow<string>('admin.appBaseUrl');

    try {
      const result = await this.adminAuth.handleCallback(code, state, {
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
      });
      this.setPendingCookie(response, result.pendingToken);
      const target = result.needsSetup ? '/mfa/setup' : '/mfa';
      return response.redirect(`${adminApp}${target}`);
    } catch {
      // Generic denial: unknown, non-staff and banned accounts land here
      // without a session and without revealing which condition matched.
      return response.redirect(`${adminApp}/access-denied`);
    }
  }

  // ---- MFA (pending cookie + CSRF) ----

  @Post('auth/mfa/setup')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setupMfa(@Req() request: Request) {
    this.assertCsrf(request);
    const pending = await this.adminAuth.verifyPendingToken(
      request.cookies?.[PENDING_COOKIE],
    );
    return envelope(await this.adminAuth.setupTotp(pending.sub));
  }

  @Post('auth/mfa/enroll')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async enrollMfa(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: MfaCodeDto,
  ) {
    this.assertCsrf(request);
    const pending = await this.adminAuth.verifyPendingToken(
      request.cookies?.[PENDING_COOKIE],
    );
    const tokens = await this.adminAuth.verifyEnroll(pending.sub, body.code, {
      ipAddress: request.ip,
      userAgent: request.header('user-agent'),
    });
    this.setRefreshCookie(response, tokens);
    this.clearPendingCookie(response);
    return envelope({
      accessToken: tokens.accessToken,
      sessionId: tokens.sessionId,
      expiresAt: tokens.expiresAt,
    });
  }

  @Post('auth/mfa/verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyMfa(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: MfaCodeDto,
  ) {
    this.assertCsrf(request);
    const pending = await this.adminAuth.verifyPendingToken(
      request.cookies?.[PENDING_COOKIE],
    );
    const tokens = await this.adminAuth.verifyChallenge(
      pending.sub,
      body.code,
      {
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
      },
    );
    this.setRefreshCookie(response, tokens);
    this.clearPendingCookie(response);
    return envelope({
      accessToken: tokens.accessToken,
      sessionId: tokens.sessionId,
      expiresAt: tokens.expiresAt,
    });
  }

  // ---- Session (refresh cookie + CSRF) ----

  @Post('auth/refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertCsrf(request);
    const tokens = await this.adminAuth.refresh(
      request.cookies?.[REFRESH_COOKIE],
      {
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
      },
    );
    this.setRefreshCookie(response, tokens);
    return envelope({
      accessToken: tokens.accessToken,
      sessionId: tokens.sessionId,
      expiresAt: tokens.expiresAt,
    });
  }

  @Post('auth/logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertCsrf(request);
    await this.adminAuth.logout(request.cookies?.[REFRESH_COOKIE]);
    this.clearRefreshCookie(response);
    this.clearPendingCookie(response);
    return envelope({ ok: true });
  }

  // ---- Self ----

  @Get('me')
  @UseGuards(AdminAuthGuard)
  async me(@Req() request: AdminAuthenticatedRequest) {
    return envelope(
      await this.adminAuth.me(request.admin.id, request.admin.sessionId),
    );
  }

  @Get('mfa/status')
  @UseGuards(AdminAuthGuard)
  async mfaStatus(@Req() request: AdminAuthenticatedRequest) {
    return envelope(await this.adminAuth.getMfaStatus(request.admin.id));
  }

  @Get('sessions')
  @UseGuards(AdminAuthGuard)
  async listSessions(@Req() request: AdminAuthenticatedRequest) {
    return envelope(
      await this.adminAuth.listSessions(request.admin.id, request.admin.sessionId),
    );
  }

  @Delete('sessions/:id')
  @UseGuards(AdminAuthGuard)
  async revokeSession(
    @Req() request: AdminAuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return envelope(
      await this.adminAuth.revokeSession(
        request.admin.id,
        request.admin.role,
        id,
        request.admin.sessionId,
      ),
    );
  }

  // ---- Staff (owner only) ----

  @Get('staff')
  @UseGuards(AdminAuthGuard, AdminPermissionsGuard)
  @RequirePermissions('staff.manage')
  async listStaff() {
    return envelope({ staff: await this.adminAuth.listStaff() });
  }

  @Post('staff/invitations')
  @UseGuards(AdminAuthGuard, AdminPermissionsGuard)
  @RequirePermissions('staff.manage')
  async createInvitation(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: CreateInvitationDto,
  ) {
    return envelope({
      invitation: await this.adminAuth.createInvitation(
        request.admin.id,
        request.admin.role,
        body.userId,
        body.role as UserRole,
      ),
    });
  }

  @Get('staff/invitations')
  @UseGuards(AdminAuthGuard, AdminPermissionsGuard)
  @RequirePermissions('staff.manage')
  async listInvitations() {
    return envelope({ invitations: await this.adminAuth.listInvitations() });
  }

  @Delete('staff/invitations/:id')
  @UseGuards(AdminAuthGuard, AdminPermissionsGuard)
  @RequirePermissions('staff.manage')
  async revokeInvitation(
    @Req() request: AdminAuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return envelope(
      await this.adminAuth.revokeInvitation(
        request.admin.id,
        request.admin.role,
        id,
      ),
    );
  }

  @Post('staff/invitations/:token/accept')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async acceptInvitation(
    @Req() request: Request,
    @Param('token') token: string,
  ) {
    this.assertCsrf(request);
    const pending = await this.adminAuth.verifyPendingToken(
      request.cookies?.[PENDING_COOKIE],
    );
    return envelope(
      await this.adminAuth.acceptInvitation(pending.sub, token, {
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
      }),
    );
  }

  @Post('staff/role-change')
  @UseGuards(AdminAuthGuard, AdminPermissionsGuard)
  @RequirePermissions('staff.manage')
  async changeRole(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: RoleChangeDto,
  ) {
    return envelope(
      await this.adminAuth.changeRole(
        request.admin.id,
        request.admin.role,
        body.userId,
        body.role,
      ),
    );
  }

  @Post('staff/mfa/reset')
  @UseGuards(AdminAuthGuard, AdminPermissionsGuard)
  @RequirePermissions('staff.manage')
  async resetMfa(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: MfaResetDto,
  ) {
    return envelope(
      await this.adminAuth.resetMfa(
        request.admin.id,
        request.admin.role,
        body.userId,
      ),
    );
  }

  // ---- cookies & CSRF ----

  private cookieFlags(maxAgeMs: number) {
    const secure = this.config.get<string>('app.nodeEnv') === 'production';
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure,
      maxAge: maxAgeMs,
    };
  }

  private setRefreshCookie(response: Response, tokens: AdminSessionTokens) {
    response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...this.cookieFlags(tokens.expiresAt.getTime() - Date.now()),
      // Host-only by design: no Domain attribute, so the privileged cookie
      // is never shared with sibling subdomains.
      path: '/',
    });
  }

  private setPendingCookie(response: Response, pendingToken: string) {
    const minutes = this.config.get<number>('admin.mfaPendingMinutes') ?? 10;
    response.cookie(PENDING_COOKIE, pendingToken, {
      ...this.cookieFlags(minutes * 60_000),
      path: '/admin/auth',
    });
  }

  private clearRefreshCookie(response: Response) {
    response.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  private clearPendingCookie(response: Response) {
    response.clearCookie(PENDING_COOKIE, { path: '/admin/auth' });
  }

  /**
   * Cookie-authenticated writes require proof of a same-origin context:
   * an allowlisted Origin header or the X-Requested-With header (which a
   * cross-site simple form cannot set). Bearer-authenticated calls skip this
   * because the token is not ambient authority.
   */
  private assertCsrf(request: Request) {
    if (request.header('authorization')?.startsWith('Bearer ')) {
      return;
    }
    if (request.header('x-requested-with') === 'XMLHttpRequest') {
      return;
    }
    const origin = request.header('origin');
    const allowed = [
      ...(this.config.get<string[]>('app.corsOrigins') ?? []),
      this.config.get<string>('admin.appBaseUrl') ?? '',
    ].filter(Boolean);
    if (origin && allowed.includes(origin)) {
      return;
    }
    throw new ForbiddenException('CSRF_VALIDATION_FAILED');
  }
}
