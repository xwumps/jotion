import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ApiToken } from '@jotion/db';
import { createApiTokenSchema, type ApiTokenDto, type CreatedApiTokenDto } from '@jotion/shared';
import { AppError, forbidden, notFound } from '../common/errors';
import { RateLimitService } from '../common/rate-limit.service';
import type { AuthUser } from '../common/request-context';
import { parse } from '../common/validation';
import { PrismaService } from '../infra/prisma.service';

/** Erkennungsmerkmal: Tokens beginnen mit "jtn_" (Secret-Scanner, Logs) */
export const TOKEN_PREFIX = 'jtn_';
const MAX_TOKENS = 50;
/** Anfragen je Token und Minute */
export const TOKEN_RATE_LIMIT = 600;
const TOUCH_MS = 60_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

const toDto = (t: ApiToken): ApiTokenDto => ({
  id: t.id,
  name: t.name,
  prefix: t.prefix,
  scope: t.scope === 'write' ? 'write' : 'read',
  expiresAt: t.expiresAt?.toISOString() ?? null,
  lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
  createdAt: t.createdAt.toISOString(),
});

/**
 * Phase 12: persönliche API-Tokens. Gespeichert wird nur der SHA-256-Hash; das Token ist einmal
 * nach dem Anlegen sichtbar. Ein Token handelt mit den Rechten seines Nutzers, "read" nur lesend.
 */
@Injectable()
export class ApiTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: RateLimitService,
  ) {}

  async list(user: AuthUser): Promise<ApiTokenDto[]> {
    const rows = await this.prisma.client.apiToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  async create(user: AuthUser, body: unknown): Promise<CreatedApiTokenDto> {
    if (user.tokenScope) throw forbidden('Tokens lassen sich nur in der Oberfläche anlegen');
    const input = parse(createApiTokenSchema, body);
    const count = await this.prisma.client.apiToken.count({ where: { userId: user.id } });
    if (count >= MAX_TOKENS)
      throw new AppError('validation_failed', `Höchstens ${MAX_TOKENS} Tokens je Konto`);
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const row = await this.prisma.client.apiToken.create({
      data: {
        userId: user.id,
        name: input.name,
        prefix: token.slice(0, 10),
        tokenHash: hash(token),
        scope: input.scope,
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 86_400_000)
          : null,
      },
    });
    return { ...toDto(row), token };
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const r = await this.prisma.client.apiToken.deleteMany({ where: { id, userId: user.id } });
    if (!r.count) throw notFound('Token');
  }

  /** Prüft ein Bearer-Token; liefert den Nutzer mit Token-Umfang oder null. */
  async authenticate(raw: string): Promise<AuthUser | null> {
    if (!raw.startsWith(TOKEN_PREFIX) || raw.length > 100) return null;
    const t = await this.prisma.client.apiToken.findUnique({
      where: { tokenHash: hash(raw) },
      include: { user: true },
    });
    if (!t || t.user.disabledAt || (t.expiresAt && t.expiresAt <= new Date())) return null;
    await this.limits.hit(`api-token:${t.id}`, TOKEN_RATE_LIMIT, 60);
    if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > TOUCH_MS)
      await this.prisma.client.apiToken.update({
        where: { id: t.id },
        data: { lastUsedAt: new Date() },
      });
    return {
      id: t.user.id,
      email: t.user.email,
      name: t.user.name,
      locale: t.user.locale,
      sessionId: `token:${t.id}`,
      isAdmin: false,
      tokenScope: t.scope === 'write' ? 'write' : 'read',
    };
  }
}
