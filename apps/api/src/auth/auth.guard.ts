import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../common/errors';
import { IS_PUBLIC } from '../common/request-context';
import { ApiTokensService, TOKEN_PREFIX } from '../tokens/api-tokens.service';
import { SESSION_COOKIE, SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Pfade, die ein API-Token nie erreicht (Konto, Tokens, Admin, OAuth-Anmeldung) */
const TOKEN_BLOCKED = ['/api/auth/', '/api/me/tokens', '/api/admin', '/api/integrations/oauth/'];
/** Abfragen, die per POST einen Filter mitschicken, aber nichts ändern (auch für lesende Tokens) */
const READ_ONLY_POST = /^\/api\/databases\/[0-9a-f-]{36}\/(query|calculate|chart|groups)$/i;

/** Globaler Guard: jede Route verlangt eine gültige Session, außer sie ist @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly tokens: ApiTokensService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    // Phase 12: API-Token im Authorization-Header (ohne Cookie)
    const auth = req.headers.authorization;
    if (auth?.startsWith(`Bearer ${TOKEN_PREFIX}`)) {
      const user = await this.tokens.authenticate(auth.slice(7).trim());
      if (!user) throw new AppError('unauthenticated', 'API-Token ungültig oder abgelaufen');
      const path = (req.url ?? '').split('?')[0]!;
      // Konto, Tokens und Admin-Bereich nur mit Anmeldung in der Oberfläche
      const whoAmI = path === '/api/auth/me' && req.method === 'GET';
      if (!whoAmI && TOKEN_BLOCKED.some((p) => path.startsWith(p)))
        throw new AppError('forbidden', 'Mit einem API-Token nicht erlaubt');
      const readOnly =
        SAFE_METHODS.has(req.method) || (req.method === 'POST' && READ_ONLY_POST.test(path));
      if (user.tokenScope === 'read' && !readOnly)
        throw new AppError('forbidden', 'Das API-Token darf nur lesen');
      req.user = user;
      return true;
    }
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
