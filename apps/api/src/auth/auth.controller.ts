import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import {
  changePasswordSchema,
  loginSchema,
  registerWithInviteSchema,
  resetPasswordSchema,
  setupSchema,
  updateProfileSchema,
} from '@jotion/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser, Public, type AuthUser } from '../common/request-context';
import { parse } from '../common/validation';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Get('setup-status')
  setupStatus() {
    return this.auth.setupStatus();
  }

  @Public()
  @Post('setup')
  async setup(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = await this.auth.setup(parse(setupSchema, body), meta(req));
    this.setCookie(reply, token);
    return { ok: true };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = await this.auth.login(parse(loginSchema, body), meta(req));
    this.setCookie(reply, token);
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.revoke(user.sessionId);
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.auth.updateProfile(user, parse(updateProfileSchema, body));
  }

  @Post('password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.auth.changePassword(user, parse(changePasswordSchema, body));
    return { ok: true };
  }

  @Public()
  @Get('invitations/:token')
  invitation(@Param('token') token: string) {
    return this.auth.invitationPreview(token);
  }

  @Public()
  @Post('register')
  async register(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = await this.auth.registerWithInvite(
      parse(registerWithInviteSchema, body),
      meta(req),
    );
    this.setCookie(reply, token);
    return { ok: true };
  }

  @Post('invitations/:token/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.auth.acceptInvitation(user, token);
  }

  @Public()
  @Post('password-reset')
  @HttpCode(200)
  async resetPassword(@Body() body: unknown) {
    await this.auth.resetPassword(parse(resetPasswordSchema, body));
    return { ok: true };
  }

  private setCookie(reply: FastifyReply, token: string): void {
    void reply.setCookie(SESSION_COOKIE, token, this.sessions.cookieOptions());
  }
}

function meta(req: FastifyRequest) {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}
