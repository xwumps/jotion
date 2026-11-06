import { ComputeEngine } from '@jotion/compute';
import type { PrismaClient } from '@jotion/db';
import { COMPUTE_JOBS, type PropagateJob, type RecomputeDatabaseJob } from '@jotion/shared';
import type { Job } from 'bullmq';
import { logger } from '../logger';

/**
 * Berechnete Properties im Hintergrund: Änderungen über Relationen weiterreichen,
 * ganze Datenbanken nach Schemaänderungen neu berechnen, Formeln mit now()/today() auffrischen.
 */
export function createComputeProcessor(prisma: PrismaClient, timeZone: string) {
  return async (job: Job) => {
    const engine = new ComputeEngine(prisma, { timeZone });
    const started = Date.now();
    switch (job.name) {
      case COMPUTE_JOBS.propagate: {
        const data = job.data as PropagateJob;
        const touched = await engine.propagate(data.databaseId, data.rowIds, {
          includeSeed: false,
        });
        await engine.emitRowsChanged(touched, data.actorId ?? null);
        return { databases: touched.size, rows: count(touched), ms: Date.now() - started };
      }
      case COMPUTE_JOBS.recomputeDatabase: {
        const data = job.data as RecomputeDatabaseJob;
        const changed = await engine.recomputeRows(data.databaseId);
        const touched = new Map([[data.databaseId, new Set(changed)]]);
        await engine.emitRowsChanged(touched, data.actorId ?? null);
        if (changed.length) {
          const more = await engine.propagate(data.databaseId, changed, { includeSeed: false });
          await engine.emitRowsChanged(more, data.actorId ?? null);
        }
        return { rows: changed.length, ms: Date.now() - started };
      }
      case COMPUTE_JOBS.refreshVolatile: {
        // Datenbanken mit Formeln, die now() oder today() verwenden
        const dbs = await prisma.$queryRaw<{ id: string }[]>`
          SELECT DISTINCT database_id::text AS id FROM db_properties
           WHERE type = 'formula' AND (config->>'volatile')::boolean IS TRUE`;
        let rows = 0;
        for (const { id } of dbs) {
          const changed = await engine.recomputeRows(id);
          rows += changed.length;
          const touched = await engine.propagate(id, changed, { includeSeed: false });
          touched.set(id, new Set([...(touched.get(id) ?? []), ...changed]));
          await engine.emitRowsChanged(touched, null);
        }
        return { databases: dbs.length, rows, ms: Date.now() - started };
      }
      default:
        logger.warn({ job: job.name }, 'Unbekannter Berechnungsjob');
        return null;
    }
  };
}

const count = (m: Map<string, Set<string>>) => [...m.values()].reduce((s, x) => s + x.size, 0);
