import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../common/errors';
import { IS_PUBLIC } from '../common/request-context';
import { SESSION_COOKIE, SessionService } from './session.service';

/** Globaler Guard: jede Route verlangt eine gültige Session, außer sie ist @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const token = req.cookies?.[SESSION_COOKIE];
    // Auch auf öffentlichen Routen den Nutzer erkennen, falls angemeldet
    if (token) {
      const user = await this.sessions.validate(token);
      if (user) req.user = user;
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic || req.user) return true;
    throw new AppError('unauthenticated', 'Nicht angemeldet');
  }
}
