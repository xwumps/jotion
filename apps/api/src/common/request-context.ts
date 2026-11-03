import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  locale: string | null;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export const IS_PUBLIC = 'jotion:isPublic';
/** Route ohne Anmeldung erreichbar. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Der angemeldete Nutzer (vom AuthGuard gesetzt). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  return req.user!;
});

export function clientIp(req: FastifyRequest): string {
  return req.ip;
}
