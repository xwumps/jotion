import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  chartConfigSchema,
  type ChartConfig,
  type ChartDataDto,
  type chartQuerySchema,
  type ViewConfig,
} from '@jotion/shared';
import {
  addDays,
  compileAggregateQuery,
  dayInZone,
  queryProperties,
  safeTimeZone,
  type AggregateRequest,
  type GroupSpec,
  type QueryContext,
} from '@jotion/query';
import type { z } from 'zod';
import { AppError, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { DatabaseAccessService, type LoadedProperty } from './database-access';

/** Redis-Schlüssel der Version einer Datenbank; der Relay erhöht ihn bei jedem database.*-Ereignis. */
export const chartVersionKey = (databaseId: string) => `jotion:chartv:${databaseId}`;
const CACHE_TTL_S = 600;

interface AggRow {
  x: string;
  series: string;
  value: number | null;
}

/**
 * Diagramme: Aggregation über die Zeilen einer Ansicht (deren Filter gilt), Zeitraum über ein
 * Datums-Property, KPI mit Vorzeitraum und Verlauf. Ergebnisse werden in Redis zwischengespeichert;
 * jede Änderung an der Datenbank erhöht deren Version und macht den Cache ungültig.
 */
@Injectable()
export class ChartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DatabaseAccessService,
    private readonly redis: RedisService,
  ) {}

  async data(
    user: AuthUser,
    databaseId: string,
    input: z.output<typeof chartQuerySchema>,
  ): Promise<ChartDataDto> {
    const a = await this.access.require(user.id, databaseId, { includeTrashed: true });
    const view = await this.prisma.client.dbView.findUnique({ where: { id: input.viewId } });
    if (!view || view.databaseId !== databaseId) throw notFound('Ansicht');
    const empty: ChartDataDto = { points: [], total: 0, previous: null, spark: [], range: null };
    if (!a.data) return empty;
    const cfg = (view.config ?? {}) as Partial<ViewConfig>;
    let chart: ChartConfig;
    try {
      chart = chartConfigSchema.parse(cfg.chart ?? {});
    } catch {
      chart = chartConfigSchema.parse({});
    }
    const tz = safeTimeZone(input.timeZone);
    const today = dayInZone(Date.now(), tz);

    // Cache: Version der Daten, Konfiguration, Zeitzone, heutiger Tag (relative Zeiträume), Nutzer (Rechte)
    const dataId = a.data.db.id;
    const version = (await this.redis.client.get(chartVersionKey(dataId)).catch(() => null)) ?? '0';
    const hash = createHash('sha256')
      .update(JSON.stringify([chart, cfg.filter ?? null, tz, today, user.id]))
      .digest('hex')
      .slice(0, 24);
    const cacheKey = `jotion:chart:${dataId}:${version}:${hash}`;
    const cached = await this.redis.client.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as ChartDataDto;

    const props = queryProperties(await this.access.properties(dataId));
    const result = await this.compute(user, dataId, props, cfg.filter ?? null, chart, tz, today);
    await this.redis.client
      .set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_S)
      .catch(() => undefined);
    return result;
  }

  /** Kontext für Drilldown und Diagramm: Filter der Ansicht, Zeitraum, Gruppen des Punkts. */
  chartContext(
    chart: ChartConfig,
    props: LoadedProperty[],
    tz: string,
    today: string,
    point?: { x?: string; series?: string },
  ): Pick<QueryContext, 'dateRange' | 'groups'> {
    const range = this.range(chart, today);
    const dateProp = chart.dateFilter
      ? props.find((p) => p.id === chart.dateFilter!.propertyId)
      : undefined;
    const groups: NonNullable<QueryContext['groups']> = [];
    const xSpec = this.spec(chart.x, props);
    const sSpec = this.spec(chart.series, props);
    if (point?.x !== undefined && xSpec) groups.push({ spec: xSpec, key: point.x });
    if (point?.series !== undefined && sSpec) groups.push({ spec: sSpec, key: point.series });
    return {
      groups,
      dateRange:
        range && dateProp
          ? { start: dateProp, end: null, from: range.from, to: range.to }
          : undefined,
    };
  }

  private spec(axis: ChartConfig['x'], props: LoadedProperty[]): GroupSpec | null {
    if (!axis) return null;
    const prop = props.find((p) => p.id === axis.propertyId);
    return prop ? { prop, dateBucket: axis.dateBucket, numberInterval: axis.numberInterval } : null;
  }

  /** Zeitraum des Datumsfilters als Kalendertage. */
  range(chart: ChartConfig, today: string): { from: string; to: string } | null {
    const f = chart.dateFilter;
    if (!f) return null;
    switch (f.range) {
      case 'all':
        return null;
      case 'last_7_days':
        return { from: addDays(today, -6), to: today };
      case 'last_30_days':
        return { from: addDays(today, -29), to: today };
      case 'last_90_days':
        return { from: addDays(today, -89), to: today };
      case 'this_month': {
        const from = `${today.slice(0, 7)}-01`;
        const next = new Date(`${from}T00:00:00Z`);
        next.setUTCMonth(next.getUTCMonth() + 1);
        return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
      }
      case 'this_year':
        return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
      case 'fixed':
        return f.from && f.to ? { from: f.from, to: f.to } : null;
    }
  }

  private async compute(
    user: AuthUser,
    dataId: string,
    props: LoadedProperty[],
    filter: ViewConfig['filter'] | null,
    chart: ChartConfig,
    tz: string,
    today: string,
  ): Promise<ChartDataDto> {
    const valueProp = chart.y.propertyId
      ? (props.find((p) => p.id === chart.y.propertyId) ?? null)
      : null;
    if (
      chart.y.measure !== 'count' &&
      chart.y.measure !== 'count_unique' &&
      valueProp?.type !== 'number'
    )
      throw new AppError(
        'validation_failed',
        'Für diese Berechnung braucht das Diagramm ein Zahl-Property',
      );
    const ctxBase = this.chartContext(chart, props, tz, today);
    const base: QueryContext = {
      databaseId: dataId,
      viewerId: user.id,
      properties: props,
      filter,
      timeZone: tz,
      dateRange: ctxBase.dateRange,
    };
    const run = async (ctx: QueryContext, req: AggregateRequest) => {
      const q = compileAggregateQuery(ctx, req);
      return this.prisma.client.$queryRawUnsafe<AggRow[]>(q.sql, ...q.parameters);
    };
    const measure = { measure: chart.y.measure, value: valueProp };
    const withAxes = chart.type !== 'kpi' && !chart.type.startsWith('progress');
    const [points, totalRows] = await Promise.all([
      withAxes
        ? run(base, {
            x: this.spec(chart.x, props),
            series: this.spec(chart.series, props),
            ...measure,
          })
        : Promise.resolve([] as AggRow[]),
      run(base, { x: null, series: null, ...measure }),
    ]);
    const total = totalRows[0]?.value ?? 0;
    const range = this.range(chart, today);

    // KPI: Vorzeitraum gleicher Länge und Verlauf
    let previous: number | null = null;
    let spark: ChartDataDto['spark'] = [];
    const dateProp = chart.dateFilter
      ? props.find((p) => p.id === chart.dateFilter!.propertyId)
      : undefined;
    if (chart.type === 'kpi' && range && dateProp) {
      const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
      if (chart.compare) {
        const prev = await run(
          {
            ...base,
            dateRange: {
              start: dateProp,
              end: null,
              from: addDays(range.from, -days),
              to: addDays(range.from, -1),
            },
          },
          { x: null, series: null, ...measure },
        );
        previous = prev[0]?.value ?? 0;
      }
      const bucket = days > 120 ? 'month' : days > 31 ? 'week' : 'day';
      const rows = await run(base, {
        x: { prop: dateProp, dateBucket: bucket, numberInterval: 1 },
        series: null,
        ...measure,
      });
      spark = rows
        .filter((r) => r.x !== '__empty__')
        .map((r) => ({ x: r.x, value: r.value ?? 0 }))
        .sort((p, q) => p.x.localeCompare(q.x));
    }
    return {
      points: points.map((p) => ({ x: p.x, series: p.series, value: p.value ?? 0 })),
      total,
      previous,
      spark,
      range,
    };
  }
}
