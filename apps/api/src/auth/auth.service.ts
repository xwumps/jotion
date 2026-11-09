import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@jotion/db';
import type {
  InvitationPreviewDto,
  MeDto,
  PageIcon,
  SetupStatusDto,
  UserDto,
  changePasswordSchema,
  loginSchema,
  registerWithInviteSchema,
  resetPasswordSchema,
  setupSchema,
  updateProfileSchema,
} from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import type { z } from 'zod';
import { SERVER_ENV } from '../config/config.module';
import { AppError } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { RateLimitService } from '../common/rate-limit.service';
import { hashToken } from '../common/tokens';
import { PrismaService } from '../infra/prisma.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

type Meta = { userAgent?: string; ip?: string };
const SETUP_LOCK = 7_301_001;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly rateLimit: RateLimitService,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
  ) {}

  async setupStatus(): Promise<SetupStatusDto> {
    return { setupRequired: (await this.prisma.client.user.count()) === 0 };
  }

  /** Ersteinrichtung: legt den ersten Nutzer als Owner samt Workspace an. Nur einmal möglich. */
  async setup(input: z.output<typeof setupSchema>, meta: Meta): Promise<string> {
    const passwordHash = await this.passwords.hash(input.password);
    const userId = await this.prisma.client.$transaction(async (tx) => {
      // Serialisiert parallele Setup-Versuche
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK})`;
      if ((await tx.user.count()) > 0)
        throw new AppError('already_set_up', 'Jotion ist bereits eingerichtet');
      const user = await tx.user.create({
        // Phase 12: wer Jotion einrichtet, ist Instanz-Admin
        data: { email: input.email, name: input.name, passwordHash, isAdmin: true },
      });
      await tx.workspace.create({
        data: {
          name: input.workspaceName,
          members: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
      return user.id;
    });
    return this.sessions.create(userId, meta);
  }

  async login(input: z.output<typeof loginSchema>, meta: Meta): Promise<string> {
    await this.rateLimit.hit(`login:ip:${meta.ip ?? 'unknown'}`, 30, 15 * 60);
    await this.rateLimit.hit(`login:email:${input.email}`, 10, 15 * 60);

    const user = await this.prisma.client.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await this.passwords.verifyDummy(input.password);
      throw new AppError('invalid_credentials', 'E-Mail oder Passwort falsch');
    }
    const ok = await this.passwords.verify(user.passwordHash, input.password);
    if (!ok || user.disabledAt)
      throw new AppError('invalid_credentials', 'E-Mail oder Passwort falsch');

    await this.rateLimit.reset(`login:email:${input.email}`);
    return this.sessions.create(user.id, meta);
  }

  async me(user: AuthUser): Promise<MeDto> {
    const memberships = await this.prisma.client.workspaceMember.findMany({
      where: { userId: user.id },
      include: { workspace: true },
      orderBy: { joinedAt: 'asc' },
    });
    return {
      user: toUserDto(user),
      workspaces: memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        icon: (m.workspace.icon as PageIcon | null) ?? null,
        role: m.role,
      })),
    };
  }

  async updateProfile(
    user: AuthUser,
    input: z.output<typeof updateProfileSchema>,
  ): Promise<UserDto> {
    const u = await this.prisma.client.user.update({
      where: { id: user.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
      },
    });
    return toUserDto(u);
  }

  async changePassword(
    user: AuthUser,
    input: z.output<typeof changePasswordSchema>,
  ): Promise<void> {
    await this.rateLimit.hit(`pwchange:${user.id}`, 10, 15 * 60);
    const u = await this.prisma.client.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await this.passwords.verify(u.passwordHash, input.currentPassword))) {
      throw new AppError('invalid_credentials', 'Aktuelles Passwort ist falsch');
    }
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(input.newPassword) },
    });
    // Andere Geräte abmelden, aktuelle Session behalten
    await this.sessions.revokeAllForUser(user.id, user.sessionId);
  }

  async invitationPreview(token: string): Promise<InvitationPreviewDto> {
    const inv = await this.prisma.client.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { workspace: { select: { name: true } } },
    });
    if (!inv || !isUsable(inv))
      throw new AppError('token_invalid', 'Einladung ungültig oder abgelaufen');
    return { workspaceName: inv.workspace.name, role: inv.role };
  }

  /** Neues Konto über Einladungslink. */
  async registerWithInvite(
    input: z.output<typeof registerWithInviteSchema>,
    meta: Meta,
  ): Promise<string> {
    await this.rateLimit.hit(`register:ip:${meta.ip ?? 'unknown'}`, 20, 15 * 60);
    const passwordHash = await this.passwords.hash(input.password);
    const userId = await this.prisma.client.$transaction(async (tx) => {
      const inv = await consumeInvitation(tx, input.token);
      if (await tx.user.findUnique({ where: { email: input.email } })) {
        throw new AppError(
          'conflict',
          'Für diese E-Mail gibt es schon ein Konto. Bitte anmelden und die Einladung annehmen.',
        );
      }
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: inv.workspaceId, userId: user.id, role: inv.role },
      });
      return user.id;
    });
    return this.sessions.create(userId, meta);
  }

  /** Bestehendes Konto tritt per Einladung einem weiteren Workspace bei. */
  async acceptInvitation(user: AuthUser, token: string): Promise<{ workspaceId: string }> {
    return this.prisma.client.$transaction(async (tx) => {
      const preview = await tx.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
      if (preview) {
        const existing = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: preview.workspaceId, userId: user.id } },
        });
        // Bereits Mitglied: Einladung nicht verbrauchen
        if (existing) return { workspaceId: preview.workspaceId };
      }
      const inv = await consumeInvitation(tx, token);
      await tx.workspaceMember.create({
        data: { workspaceId: inv.workspaceId, userId: user.id, role: inv.role },
      });
      return { workspaceId: inv.workspaceId };
    });
  }

  async resetPassword(input: z.output<typeof resetPasswordSchema>): Promise<void> {
    const passwordHash = await this.passwords.hash(input.newPassword);
    const userId = await this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ user_id: string }[]>`
        UPDATE password_reset_tokens SET used_at = now()
         WHERE token_hash = ${hashToken(input.token)} AND used_at IS NULL AND expires_at > now()
         RETURNING user_id::text`;
      const row = rows[0];
      if (!row) throw new AppError('token_invalid', 'Link ungültig oder abgelaufen');
      await tx.user.update({ where: { id: row.user_id }, data: { passwordHash } });
      return row.user_id;
    });
    await this.sessions.revokeAllForUser(userId);
  }

  publicUrl(path: string): string {
    return new URL(path, this.env.JOTION_PUBLIC_URL).toString();
  }
}

function toUserDto(u: {
  id: string;
  email: string;
  name: string;
  locale: string | null;
  isAdmin?: boolean;
}): UserDto {
  return { id: u.id, email: u.email, name: u.name, locale: u.locale, isAdmin: !!u.isAdmin };
}

function isUsable(inv: {
  revokedAt: Date | null;
  expiresAt: Date;
  uses: number;
  maxUses: number;
}): boolean {
  return !inv.revokedAt && inv.expiresAt > new Date() && inv.uses < inv.maxUses;
}

/** Verbraucht eine Einladung atomar (verhindert Überschreitung von maxUses bei parallelen Anfragen). */
async function consumeInvitation(tx: Prisma.TransactionClient, token: string) {
  const rows = await tx.$queryRaw<{ workspace_id: string; role: 'OWNER' | 'MEMBER' }[]>`
    UPDATE invitations SET uses = uses + 1
     WHERE token_hash = ${hashToken(token)} AND revoked_at IS NULL AND expires_at > now() AND uses < max_uses
     RETURNING workspace_id::text, role::text AS role`;
  const row = rows[0];
  if (!row) throw new AppError('token_invalid', 'Einladung ungültig oder abgelaufen');
  return { workspaceId: row.workspace_id, role: row.role };
}
