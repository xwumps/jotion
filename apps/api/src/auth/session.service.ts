import { Inject, Injectable } from '@nestjs/common';
import type { ServerEnv } from '@jotion/shared/env';
import { SERVER_ENV } from '../config/config.module';
import type { AuthUser } from '../common/request-context';
import { generateToken, hashToken } from '../common/tokens';
import { PrismaService } from '../infra/prisma.service';

export const SESSION_COOKIE = 'jotion_session';
const SESSION_DAYS = 30;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface CookieOptions {
  path: string;
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  maxAge: number;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
  ) {}

  cookieOptions(): CookieOptions {
    return {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.JOTION_PUBLIC_URL.startsWith('https://'),
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    };
  }

  /** Legt eine Session an und liefert das Klartext-Token für das Cookie. */
  async create(userId: string, meta: { userAgent?: string; ip?: string }): Promise<string> {
    const token = generateToken();
    await this.prisma.client.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        ip: meta.ip ?? null,
        expiresAt: this.expiry(),
      },
    });
    return token;
  }

  /** Prüft ein Token. Verlängert die Session gleitend, höchstens alle 5 Minuten. */
  async validate(token: string): Promise<AuthUser | null> {
    if (!token || token.length > 200) return null;
    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date() || session.user.disabledAt) return null;

    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.client.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), expiresAt: this.expiry() },
      });
    }
    const { user } = session;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale,
      sessionId: session.id,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.client.session.deleteMany({ where: { id: sessionId } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.client.session.deleteMany({
      where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    });
  }

  private expiry(): Date {
    return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  }
}
