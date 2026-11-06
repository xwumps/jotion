import { Injectable } from '@nestjs/common';
import type { Page, Prisma } from '@jotion/db';
import {
  analyzeFormula,
  rollupAggregationsFor,
  rollupResultType,
  type ComputeProperty,
} from '@jotion/compute';
import {
  keyBetween,
  parsePropertyConfig,
  ROLLUP_AGGREGATIONS,
  type PropertyType,
  type RollupAggregation,
} from '@jotion/shared';
import { AppError } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../permissions/permission.service';
import { DatabaseAccessService, type LoadedProperty } from './database-access';

type Tx = Prisma.TransactionClient;

export const COMPUTED_TYPES: PropertyType[] = ['relation', 'rollup', 'formula'];

const toCompute = (p: LoadedProperty): ComputeProperty => ({
  id: p.id,
  name: p.name,
  type: p.type,
  config: (p.config ?? {}) as Record<string, unknown>,
});

export interface PreparedConfig {
  config: Record<string, unknown>;
  /** Zweiseitige Relation: Gegen-Property in dieser Datenbank anlegen */
  reverse?: { databaseId: string; name: string };
}

/**
 * Schema-Regeln für Relation, Rollup und Formel: Ziele prüfen, Ergebnistypen ableiten,
 * Gegen-Relationen pflegen, Formeln bei Umbenennungen anpassen.
 */
@Injectable()
export class ComputedSchemaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    private readonly access: DatabaseAccessService,
  ) {}

  async prepare(
    user: AuthUser,
    data: { db: { id: string }; page: Page },
    type: PropertyType,
    raw: Record<string, unknown>,
    opts: { selfId?: string; existing?: Record<string, unknown>; name?: string } = {},
  ): Promise<PreparedConfig> {
    const props = await this.access.properties(data.db.id);
    if (type === 'relation') {
      const { reverseName, ...rest } = raw as { reverseName?: unknown } & Record<string, unknown>;
      const merged = { ...(opts.existing ?? {}), ...rest };
      const cfg = this.parse('relation', merged) as {
        targetDatabaseId: string;
        twoWay: boolean;
        reversePropertyId: string | null;
        limit: 'one' | 'many';
      };
      if (opts.existing && opts.existing.targetDatabaseId !== cfg.targetDatabaseId)
        throw new AppError(
          'validation_failed',
          'Die Zieldatenbank einer Relation kann nicht geändert werden',
        );
      const target = await this.requireTarget(user, data.page, cfg.targetDatabaseId);
      // Gegen-Relation: beim Anlegen oder beim Einschalten von "zweiseitig"
      const wantsReverse = cfg.twoWay && !cfg.reversePropertyId;
      return {
        config: { ...cfg, reversePropertyId: cfg.twoWay ? cfg.reversePropertyId : null },
        ...(wantsReverse
          ? {
              reverse: {
                databaseId: target.id,
                name:
                  typeof reverseName === 'string' && reverseName.trim()
                    ? reverseName.trim().slice(0, 200)
                    : (data.page.title || 'Verknüpft').slice(0, 200),
              },
            }
          : {}),
      };
    }
    if (type === 'rollup') {
      const merged = { ...(opts.existing ?? {}), ...raw };
      const cfg = this.parse('rollup', merged) as {
        relationPropertyId: string;
        targetPropertyId: string;
        aggregation: RollupAggregation;
      };
      const rel = props.find((p) => p.id === cfg.relationPropertyId);
      if (!rel || rel.type !== 'relation')
        throw new AppError('validation_failed', 'Rollup braucht eine Relation dieser Datenbank');
      const targetDb = String((rel.config as { targetDatabaseId: string }).targetDatabaseId);
      const targetProps = await this.access.properties(targetDb);
      const target = targetProps.find((p) => p.id === cfg.targetPropertyId);
      if (!target)
        throw new AppError('validation_failed', 'Property der verknüpften Datenbank fehlt');
      if (
        !(ROLLUP_AGGREGATIONS as readonly string[]).includes(cfg.aggregation) ||
        !rollupAggregationsFor(target.type).includes(cfg.aggregation)
      )
        throw new AppError('validation_failed', 'Diese Berechnung passt nicht zum Property');
      return { config: { ...cfg, resultType: rollupResultType(cfg.aggregation, target.type) } };
    }
    if (type === 'formula') {
      const expression = String(raw.expression ?? opts.existing?.expression ?? '');
      // Alle Properties (das eigene mit der neuen Formel), damit Zyklen über andere Formeln auffallen
      const candidates = props
        .map(toCompute)
        .map((p) => (p.id === opts.selfId ? { ...p, config: { ...p.config, expression } } : p));
      const a = analyzeFormula(expression, candidates, opts.selfId);
      if (a.error)
        throw new AppError('validation_failed', a.error, {
          formula: { message: a.error, start: a.errorAt?.start ?? 0, end: a.errorAt?.end ?? 0 },
        });
      return {
        config: this.parse('formula', {
          expression,
          resultType: a.resultType,
          error: null,
          volatile: a.volatile,
        }) as Record<string, unknown>,
      };
    }
    return { config: raw };
  }

  private parse(type: PropertyType, config: unknown) {
    try {
      return parsePropertyConfig(type, config);
    } catch (err) {
      const msg =
        (err as { issues?: { message: string }[] }).issues?.[0]?.message ??
        'Ungültige Konfiguration';
      throw new AppError('validation_failed', msg);
    }
  }

  /**
   * Zieldatenbank einer Relation: im selben Workspace, für den Nutzer sichtbar, keine Linked
   * Database. Eine Teamdatenbank darf nicht auf eine private Datenbank zeigen (sonst stünden
   * private Titel in Rollups und Formeln für alle).
   */
  private async requireTarget(user: AuthUser, source: Page, targetId: string) {
    const page = await this.prisma.client.page.findUnique({ where: { id: targetId } });
    const db = await this.prisma.client.database.findUnique({ where: { id: targetId } });
    if (
      !page ||
      !db ||
      page.kind !== 'DATABASE' ||
      page.deletedAt ||
      page.workspaceId !== source.workspaceId ||
      !this.perms.canSee(user.id, page)
    )
      throw new AppError('validation_failed', 'Zieldatenbank nicht gefunden');
    if (db.sourceDatabaseId)
      throw new AppError(
        'validation_failed',
        'Eine verknüpfte Ansicht kann kein Ziel einer Relation sein',
      );
    if (source.scope === 'TEAM' && page.scope === 'PRIVATE')
      throw new AppError(
        'validation_failed',
        'Eine Teamdatenbank kann nicht auf eine private Datenbank verweisen',
      );
    return db;
  }

  /** Legt die Gegen-Relation an, spiegelt vorhandene Verknüpfungen und liefert ihre ID. */
  async createReverse(
    tx: Tx,
    forward: { id: string; databaseId: string },
    reverse: { databaseId: string; name: string },
  ): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dbschema:${reverse.databaseId}`}, 0))`;
    const last = await tx.dbProperty.findFirst({
      where: { databaseId: reverse.databaseId },
      orderBy: { position: 'desc' },
    });
    const names = new Set(
      (
        await tx.dbProperty.findMany({
          where: { databaseId: reverse.databaseId },
          select: { name: true },
        })
      ).map((p) => p.name),
    );
    let name = reverse.name;
    for (let i = 2; names.has(name); i++) name = `${reverse.name} (${i})`;
    const created = await tx.dbProperty.create({
      data: {
        databaseId: reverse.databaseId,
        type: 'relation',
        name,
        position: keyBetween(last?.position ?? null, null),
        config: {
          targetDatabaseId: forward.databaseId,
          twoWay: true,
          reversePropertyId: forward.id,
          limit: 'many',
        },
      },
    });
    await tx.$executeRaw`
      INSERT INTO relation_links (database_id, property_id, from_row_id, to_row_id, position)
      SELECT ${reverse.databaseId}::uuid, ${created.id}::uuid, l.to_row_id, l.from_row_id, l.position
        FROM relation_links l WHERE l.property_id = ${forward.id}::uuid
      ON CONFLICT DO NOTHING`;
    return created.id;
  }

  /** Formeln nach Schemaänderungen neu prüfen (Ergebnistyp, Fehler wie fehlende Properties). */
  async reanalyzeFormulas(tx: Tx, databaseId: string): Promise<void> {
    const props = (await this.access.properties(databaseId, tx)).map(toCompute);
    for (const f of props.filter((p) => p.type === 'formula')) {
      const a = analyzeFormula(String(f.config.expression ?? ''), props, f.id);
      const next = { ...f.config, resultType: a.resultType, error: a.error, volatile: a.volatile };
      if (JSON.stringify(next) !== JSON.stringify(f.config))
        await tx.dbProperty.update({
          where: { id: f.id },
          data: { config: next as Prisma.InputJsonValue },
        });
      // Spätere Formeln sehen den neuen Ergebnistyp
      f.config = next;
    }
  }

  /** Umbenennen: prop("Alt") in Formeln derselben Datenbank auf den neuen Namen ändern. */
  async renameReferences(
    tx: Tx,
    databaseId: string,
    oldName: string,
    newName: string,
  ): Promise<void> {
    if (oldName === newName) return;
    const formulas = await tx.dbProperty.findMany({ where: { databaseId, type: 'formula' } });
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const quoted = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const re = new RegExp(`prop\\(\\s*(["'])${esc(oldName)}\\1\\s*\\)`, 'g');
    for (const f of formulas) {
      const cfg = (f.config ?? {}) as { expression?: string };
      const expr = String(cfg.expression ?? '');
      const next = expr.replace(re, `prop(${quoted(newName)})`);
      if (next !== expr)
        await tx.dbProperty.update({
          where: { id: f.id },
          data: { config: { ...cfg, expression: next } as Prisma.InputJsonValue },
        });
    }
  }
}
