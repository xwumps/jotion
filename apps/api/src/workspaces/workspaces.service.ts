import { Inject, Injectable } from '@nestjs/common';
import type {
  InvitationDto,
  MemberDto,
  PageIcon,
  ResetLinkDto,
  WorkspaceSummaryDto,
  createInvitationSchema,
  createWorkspaceSchema,
  updateMemberSchema,
  updateWorkspaceSchema,
} from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import type { z } from 'zod';
import { SERVER_ENV } from '../config/config.module';
import { AppError, forbidden, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { generateToken, hashToken } from '../common/tokens';
import { recordEvent } from '../events/outbox';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../permissions/permission.service';
import { SessionService } from '../auth/session.service';

const RESET_LINK_HOURS = 24;

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    private readonly sessions: SessionService,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
  ) {}

  async create(
    user: AuthUser,
    input: z.output<typeof createWorkspaceSchema>,
  ): Promise<WorkspaceSummaryDto> {
    const ws = await this.prisma.client.workspace.create({
      data: {
        name: input.name,
        icon: input.icon ?? undefined,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    return { id: ws.id, name: ws.name, icon: (ws.icon as PageIcon | null) ?? null, role: 'OWNER' };
  }

  async get(user: AuthUser, workspaceId: string): Promise<WorkspaceSummaryDto> {
    const role = await this.perms.requireMember(user.id, workspaceId);
    const ws = await this.prisma.client.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    return { id: ws.id, name: ws.name, icon: (ws.icon as PageIcon | null) ?? null, role };
  }

  async update(
    user: AuthUser,
    workspaceId: string,
    input: z.output<typeof updateWorkspaceSchema>,
  ): Promise<WorkspaceSummaryDto> {
    await this.perms.requireOwner(user.id, workspaceId);
    const ws = await this.prisma.client.$transaction(async (tx) => {
      const ws = await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.icon !== undefined ? { icon: input.icon ?? undefined } : {}),
        },
      });
      await recordEvent(tx, {
        workspaceId,
        type: 'workspace.updated',
        entityId: workspaceId,
        actorId: user.id,
      });
      return ws;
    });
    return { id: ws.id, name: ws.name, icon: (ws.icon as PageIcon | null) ?? null, role: 'OWNER' };
  }

  async members(user: AuthUser, workspaceId: string): Promise<MemberDto[]> {
    await this.perms.requireMember(user.id, workspaceId);
    const rows = await this.prisma.client.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    }));
  }

  async updateMember(
    user: AuthUser,
    workspaceId: string,
    userId: string,
    input: z.output<typeof updateMemberSchema>,
  ): Promise<void> {
    await this.perms.requireOwner(user.id, workspaceId);
    await this.prisma.client.$transaction(async (tx) => {
      const member = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      if (!member) throw notFound('Mitglied');
      if (member.role === 'OWNER' && input.role !== 'OWNER')
        await assertNotLastOwner(tx, workspaceId);
      await tx.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId } },
        data: { role: input.role },
      });
      await recordEvent(tx, {
        workspaceId,
        type: 'members.changed',
        entityId: userId,
        actorId: user.id,
      });
    });
  }

  /** Owner entfernt Mitglied, oder Mitglied verlässt den Workspace selbst. */
  async removeMember(user: AuthUser, workspaceId: string, userId: string): Promise<void> {
    if (userId !== user.id) await this.perms.requireOwner(user.id, workspaceId);
    else await this.perms.requireMember(user.id, workspaceId);
    await this.prisma.client.$transaction(async (tx) => {
      const member = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      if (!member) throw notFound('Mitglied');
      if (member.role === 'OWNER') await assertNotLastOwner(tx, workspaceId);
      await tx.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId, userId } } });
      await recordEvent(tx, {
        workspaceId,
        type: 'members.changed',
        entityId: userId,
        actorId: user.id,
      });
    });
  }

  async invitations(user: AuthUser, workspaceId: string): Promise<InvitationDto[]> {
    await this.perms.requireOwner(user.id, workspaceId);
    const rows = await this.prisma.client.invitation.findMany({
      where: { workspaceId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.filter((i) => i.uses < i.maxUses).map(toInvitationDto);
  }

  async createInvitation(
    user: AuthUser,
    workspaceId: string,
    input: z.output<typeof createInvitationSchema>,
  ): Promise<InvitationDto> {
    await this.perms.requireOwner(user.id, workspaceId);
    const token = generateToken();
    const inv = await this.prisma.client.invitation.create({
      data: {
        workspaceId,
        tokenHash: hashToken(token),
        role: input.role,
        note: input.note ?? null,
        maxUses: input.maxUses,
        createdById: user.id,
        expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
      },
    });
    return { ...toInvitationDto(inv), url: this.url(`/invite/${token}`) };
  }

  async revokeInvitation(user: AuthUser, workspaceId: string, invitationId: string): Promise<void> {
    await this.perms.requireOwner(user.id, workspaceId);
    const res = await this.prisma.client.invitation.updateMany({
      where: { id: invitationId, workspaceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw notFound('Einladung');
  }

  /**
   * Passwort-Reset ohne E-Mail: Owner erzeugt einen Link für ein Mitglied.
   * Nur erlaubt, wenn der Owner in JEDEM Workspace des Mitglieds Owner ist,
   * damit niemand über einen eigenen Workspace fremde Konten übernehmen kann.
   */
  async createResetLink(
    user: AuthUser,
    workspaceId: string,
    targetUserId: string,
  ): Promise<ResetLinkDto> {
    await this.perms.requireOwner(user.id, workspaceId);
    if (targetUserId === user.id)
      throw new AppError('bad_request', 'Eigenes Passwort bitte in den Kontoeinstellungen ändern');
    const targetWorkspaces = await this.prisma.client.workspaceMember.findMany({
      where: { userId: targetUserId },
      select: { workspaceId: true },
    });
    if (!targetWorkspaces.some((w) => w.workspaceId === workspaceId)) throw notFound('Mitglied');
    const ownerOf = await this.prisma.client.workspaceMember.findMany({
      where: {
        userId: user.id,
        role: 'OWNER',
        workspaceId: { in: targetWorkspaces.map((w) => w.workspaceId) },
      },
      select: { workspaceId: true },
    });
    if (ownerOf.length !== targetWorkspaces.length) {
      throw forbidden('Das Mitglied gehört auch zu Workspaces, in denen du kein Owner bist');
    }
    const token = generateToken();
    const expiresAt = new Date(Date.now() + RESET_LINK_HOURS * 60 * 60 * 1000);
    await this.prisma.client.$transaction([
      // Ältere offene Links ungültig machen
      this.prisma.client.passwordResetToken.updateMany({
        where: { userId: targetUserId, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.client.passwordResetToken.create({
        data: {
          userId: targetUserId,
          tokenHash: hashToken(token),
          createdById: user.id,
          expiresAt,
        },
      }),
    ]);
    return { url: this.url(`/reset-password/${token}`), expiresAt: expiresAt.toISOString() };
  }

  private url(path: string): string {
    return new URL(path, this.env.JOTION_PUBLIC_URL).toString();
  }

  /** Für Tests und späteres Deaktivieren: alle Sessions eines Nutzers beenden. */
  revokeSessions(userId: string): Promise<void> {
    return this.sessions.revokeAllForUser(userId);
  }
}

async function assertNotLastOwner(
  tx: {
    workspaceMember: {
      count: (a: { where: { workspaceId: string; role: 'OWNER' } }) => Promise<number>;
    };
  },
  workspaceId: string,
) {
  const owners = await tx.workspaceMember.count({ where: { workspaceId, role: 'OWNER' } });
  if (owners <= 1) throw new AppError('conflict', 'Ein Workspace braucht mindestens einen Owner');
}

function toInvitationDto(i: {
  id: string;
  role: 'OWNER' | 'MEMBER';
  note: string | null;
  expiresAt: Date;
  maxUses: number;
  uses: number;
  createdAt: Date;
}): InvitationDto {
  return {
    id: i.id,
    role: i.role,
    note: i.note,
    expiresAt: i.expiresAt.toISOString(),
    maxUses: i.maxUses,
    uses: i.uses,
    createdAt: i.createdAt.toISOString(),
  };
}
