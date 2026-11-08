'use client';

import {
  chartConfigSchema,
  type ChartConfig,
  type ChartDataDto,
  type DatabaseDto,
  type MemberDto,
  type RowQueryResultDto,
  type ViewConfig,
  type ViewDto,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useQuery } from '@tanstack/react-query';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { ArrowDownRight, ArrowUpRight, FileText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiPost } from '@/lib/api-client';
import { PageIcon } from '../../page/page-icon';
import { Dialog, DialogContent } from '../../ui/dialog';
import { formatNumber } from '../property-meta';
import { dbKeys, timeZone } from '../use-database';
import { useGroupLabels } from './board-view';
import { ChartBuilder } from './chart-builder';
import { PALETTES, prepareChart, type PreparedChart } from './chart-data';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

export function chartConfigOf(view: ViewDto): ChartConfig {
  try {
    return chartConfigSchema.parse(view.config.chart ?? {});
  } catch {
    return chartConfigSchema.parse({});
  }
}

export function useChartData(db: DatabaseDto, view: ViewDto, enabled = true) {
  return useQuery({
    // Unter dbRows: Echtzeit-Ereignisse der Datenbank laden das Diagramm neu
    queryKey: [
      ...dbKeys.rows(db.dataId),
      db.id,
      view.id,
      'chart',
      view.config.chart,
      view.config.filter,
    ],
    enabled: enabled && !db.sourceMissing,
    queryFn: () =>
      apiPost<ChartDataDto>(`/databases/${db.id}/chart`, { viewId: view.id, timeZone: timeZone() }),
    placeholderData: (prev) => prev,
  });
}

/** Farben aus den Design-Tokens (hell und dunkel). */
function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    fg: v('--fg', '#37352f'),
    muted: v('--fg-muted', '#787774'),
    border: v('--border', '#e9e9e7'),
    bg: v('--bg-elevated', '#ffffff'),
  };
}

function useThemeVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setV((x) => x + 1));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    return () => obs.disconnect();
  }, []);
  return v;
}

interface Props {
  db: DatabaseDto;
  view: ViewDto;
  members: MemberDto[];
  editable: boolean;
  onOpenRow: (rowId: string) => void;
  saveConfig: (patch: Partial<ViewConfig>) => void;
  /** Eingebettet (Block, Widget): ohne Bearbeiten, Höhe vom Container */
  embedded?: boolean;
  height?: number;
}

export function ChartView({
  db,
  view,
  members,
  editable,
  onOpenRow,
  saveConfig,
  embedded,
  height,
}: Props) {
  const t = useTranslations('charts');
  const cfg = chartConfigOf(view);
  const q = useChartData(db, view);
  const [drill, setDrill] = useState<{ x?: string; series?: string; title: string } | null>(null);
  const needsX = !['kpi', 'progress_bar', 'progress_ring'].includes(cfg.type) && !cfg.x;
  const h = height ?? cfg.display.height;

  return (
    <div
      className={cn('flex flex-col', !embedded && 'pt-2')}
      data-testid="chart-view"
      data-chart-type={cfg.type}
    >
      {!embedded && editable && (
        <div className="flex justify-end pb-1">
          <ChartBuilder db={db} cfg={cfg} onChange={(chart) => saveConfig({ chart })} />
        </div>
      )}
      {needsX ? (
        <div
          className="flex items-center justify-center text-[14px] text-fg-subtle"
          style={{ height: Math.min(h, 200) }}
          data-testid="chart-empty"
        >
          {t('chooseX')}
        </div>
      ) : !q.data ? (
        <div style={{ height: h }} aria-busy="true" />
      ) : cfg.type === 'kpi' ? (
        <Kpi cfg={cfg} data={q.data} height={h} />
      ) : cfg.type === 'progress_bar' || cfg.type === 'progress_ring' ? (
        <Progress cfg={cfg} data={q.data} height={h} />
      ) : (
        <EChart db={db} cfg={cfg} data={q.data} members={members} height={h} onPick={setDrill} />
      )}
      {drill && (
        <Drilldown
          db={db}
          view={view}
          point={drill}
          onClose={() => setDrill(null)}
          onOpenRow={(id) => {
            setDrill(null);
            onOpenRow(id);
          }}
        />
      )}
    </div>
  );
}

function EChart({
  db,
  cfg,
  data,
  members,
  height,
  onPick,
}: {
  db: DatabaseDto;
  cfg: ChartConfig;
  data: ChartDataDto;
  members: MemberDto[];
  height: number;
  onPick: (p: { x?: string; series?: string; title: string }) => void;
}) {
  const locale = useLocale();
  const labels = useGroupLabels();
  const t = useTranslations('charts');
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const themeV = useThemeVersion();
  const prepared = useMemo(
    () => prepareChart(db, cfg, data, members, locale, labels),
    [db, cfg, data, members, locale, labels],
  );
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!host.current) return;
    const c = echarts.init(host.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.setOption(buildOption(cfg, prepared, themeColors(), locale, t('value')), true);
    c.off('click');
    c.on('click', (p: { dataIndex: number; seriesIndex?: number; name?: string }) => {
      const pie = cfg.type === 'pie' || cfg.type === 'donut';
      const cat = prepared.categories[p.dataIndex];
      const ser = pie ? undefined : prepared.series[p.seriesIndex ?? 0];
      if (!cat) return;
      pickRef.current({
        x: cat.key,
        series: ser && ser.key !== '' ? ser.key : undefined,
        title: [cat.label, ser?.label].filter(Boolean).join(' · '),
      });
    });
  }, [cfg, prepared, locale, themeV, t]);

  return <div ref={host} style={{ height, width: '100%' }} data-testid="echart" />;
}

function buildOption(
  cfg: ChartConfig,
  p: PreparedChart,
  colors: ReturnType<typeof themeColors>,
  locale: string,
  valueLabel: string,
): echarts.EChartsCoreOption {
  const palette = PALETTES[cfg.display.palette] ?? PALETTES.jotion!;
  const fmt = (v: number) =>
    cfg.stack === 'percent'
      ? `${v.toLocaleString(locale)} %`
      : v.toLocaleString(locale, { maximumFractionDigits: 2 });
  const text = { color: colors.muted, fontFamily: 'inherit' };
  const tooltip = {
    trigger: cfg.type === 'pie' || cfg.type === 'donut' || cfg.type === 'scatter' ? 'item' : 'axis',
    backgroundColor: colors.bg,
    borderColor: colors.border,
    textStyle: { color: colors.fg },
    valueFormatter: (v: number) => fmt(Number(v)),
  };
  const legend = {
    show: cfg.display.legend && (p.series.length > 1 || cfg.type === 'pie' || cfg.type === 'donut'),
    bottom: 0,
    textStyle: text,
    type: 'scroll',
  };

  if (cfg.type === 'pie' || cfg.type === 'donut') {
    const s = p.series[0];
    return {
      color: palette,
      tooltip,
      legend,
      series: [
        {
          type: 'pie',
          radius: cfg.type === 'donut' ? ['45%', '72%'] : '72%',
          center: ['50%', legend.show ? '45%' : '50%'],
          label: {
            show: cfg.display.dataLabels,
            color: colors.fg,
            formatter: (x: { name: string; percent: number }) => `${x.name}: ${x.percent} %`,
          },
          itemStyle: { borderColor: colors.bg, borderWidth: 2 },
          data: p.categories.map((c, i) => ({
            name: c.label,
            value: s?.values[i] ?? 0,
            ...(c.color ? { itemStyle: { color: c.color } } : {}),
          })),
        },
      ],
    };
  }

  const horizontal = cfg.type === 'bar_horizontal';
  const category = {
    type: 'category',
    data: p.categories.map((c) => c.label),
    name: cfg.display.xTitle || undefined,
    nameLocation: 'middle',
    nameGap: horizontal ? 60 : 28,
    axisLabel: { ...text, hideOverlap: true },
    axisLine: { lineStyle: { color: colors.border } },
    axisTick: { show: false },
  };
  const valueAxis = {
    type: 'value',
    name: cfg.display.yTitle || undefined,
    nameLocation: 'middle',
    nameGap: 44,
    max: cfg.stack === 'percent' ? 100 : undefined,
    axisLabel: { ...text, formatter: (v: number) => fmt(v) },
    splitLine: { show: cfg.display.grid, lineStyle: { color: colors.border } },
  };
  const singleSeriesColors = p.series.length === 1 && p.categories.some((c) => c.color);
  const series = p.series.map((s, si) => {
    const base = {
      name: s.label || valueLabel,
      stack: cfg.stack !== 'none' ? 'all' : undefined,
      label: {
        show: cfg.display.dataLabels,
        position: cfg.stack === 'none' ? 'top' : 'inside',
        color: colors.fg,
        formatter: (x: { value: number }) => fmt(Number(x.value)),
      },
      ...(s.color ? { itemStyle: { color: s.color } } : {}),
      emphasis: { focus: 'series' },
    };
    if (cfg.type === 'line' || cfg.type === 'area')
      return {
        ...base,
        type: 'line',
        smooth: cfg.display.smooth,
        showSymbol: p.categories.length <= 60,
        areaStyle: cfg.type === 'area' ? { opacity: 0.25 } : undefined,
        data: s.values,
      };
    if (cfg.type === 'scatter') return { ...base, type: 'scatter', symbolSize: 10, data: s.values };
    return {
      ...base,
      type: 'bar',
      barMaxWidth: 48,
      data: s.values.map((v, i) => {
        const c = p.categories[i]?.color;
        return singleSeriesColors && c ? { value: v, itemStyle: { color: c } } : v;
      }),
      itemStyle: {
        ...(s.color ? { color: s.color } : { color: palette[si % palette.length] }),
        borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0],
      },
    };
  });
  return {
    color: palette,
    tooltip,
    legend,
    grid: { left: 16, right: 16, top: 16, bottom: legend.show ? 40 : 16, containLabel: true },
    xAxis: horizontal ? valueAxis : category,
    yAxis: horizontal ? { ...category, inverse: true } : valueAxis,
    series,
  };
}

function Kpi({ cfg, data, height }: { cfg: ChartConfig; data: ChartDataDto; height: number }) {
  const locale = useLocale();
  const t = useTranslations('charts');
  const host = useRef<HTMLDivElement>(null);
  const themeV = useThemeVersion();
  const delta =
    data.previous !== null && data.previous !== 0
      ? ((data.total - data.previous) / Math.abs(data.previous)) * 100
      : null;
  useEffect(() => {
    if (!host.current || !data.spark.length) return;
    const c = echarts.init(host.current);
    const col = PALETTES[cfg.display.palette]?.[0] ?? '#2383e2';
    c.setOption({
      grid: { left: 0, right: 0, top: 4, bottom: 0 },
      xAxis: { type: 'category', show: false, data: data.spark.map((s) => s.x) },
      yAxis: { type: 'value', show: false },
      series: [
        {
          type: 'line',
          data: data.spark.map((s) => s.value),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: col },
          areaStyle: { color: col, opacity: 0.15 },
        },
      ],
    });
    return () => c.dispose();
  }, [data.spark, cfg.display.palette, themeV]);
  return (
    <div
      className="flex flex-col justify-center gap-1 px-2"
      style={{ minHeight: Math.min(height, 200) }}
      data-testid="chart-kpi"
    >
      <div className="text-[40px] font-semibold leading-tight tabular-nums" data-testid="kpi-value">
        {formatNumber(data.total, undefined, locale)}
      </div>
      {cfg.compare && data.previous !== null && (
        <div
          className={cn(
            'flex items-center gap-1 text-[13px]',
            delta !== null && delta < 0 ? 'text-[var(--c-red)]' : 'text-[var(--c-green,#448361)]',
          )}
          data-testid="kpi-delta"
        >
          {delta !== null && delta < 0 ? (
            <ArrowDownRight className="size-4" />
          ) : (
            <ArrowUpRight className="size-4" />
          )}
          {delta === null
            ? '—'
            : `${delta > 0 ? '+' : ''}${delta.toLocaleString(locale, { maximumFractionDigits: 1 })} %`}
          <span className="text-fg-subtle">
            {t('vsPrevious', { value: formatNumber(data.previous, undefined, locale) })}
          </span>
        </div>
      )}
      {data.spark.length > 0 && <div ref={host} className="h-[48px] w-full" />}
    </div>
  );
}

function Progress({ cfg, data, height }: { cfg: ChartConfig; data: ChartDataDto; height: number }) {
  const locale = useLocale();
  const t = useTranslations('charts');
  const target = cfg.target ?? 100;
  const pct = target ? Math.max(0, Math.min(100, (data.total / target) * 100)) : 0;
  const color = PALETTES[cfg.display.palette]?.[0] ?? '#2383e2';
  const label = `${formatNumber(data.total, undefined, locale)} / ${formatNumber(target, undefined, locale)}`;
  if (cfg.type === 'progress_ring') {
    const r = 52;
    const c = 2 * Math.PI * r;
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: Math.min(height, 220) }}
        data-testid="chart-progress"
      >
        <svg
          viewBox="0 0 128 128"
          className="size-[140px]"
          role="img"
          aria-label={t('progressLabel', { pct: Math.round(pct) })}
        >
          <circle cx="64" cy="64" r={r} fill="none" stroke="var(--border)" strokeWidth="12" />
          <circle
            cx="64"
            cy="64"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * c} ${c}`}
            transform="rotate(-90 64 64)"
          />
          <text
            x="64"
            y="62"
            textAnchor="middle"
            className="fill-[var(--fg)] text-[22px] font-semibold"
          >
            {Math.round(pct)} %
          </text>
          <text x="64" y="82" textAnchor="middle" className="fill-[var(--fg-muted)] text-[10px]">
            {label}
          </text>
        </svg>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col justify-center gap-2 px-2"
      style={{ minHeight: 80 }}
      data-testid="chart-progress"
    >
      <div className="flex justify-between text-[13px] text-fg-muted">
        <span>{label}</span>
        <span className="font-medium text-fg">{Math.round(pct)} %</span>
      </div>
      <div
        className="h-3 overflow-hidden rounded-full bg-active"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function Drilldown({
  db,
  view,
  point,
  onClose,
  onOpenRow,
}: {
  db: DatabaseDto;
  view: ViewDto;
  point: { x?: string; series?: string; title: string };
  onClose: () => void;
  onOpenRow: (id: string) => void;
}) {
  const t = useTranslations('charts');
  const td = useTranslations('database');
  const rows = useQuery({
    queryKey: [...dbKeys.rows(db.dataId), db.id, view.id, 'drill', point.x, point.series],
    queryFn: () =>
      apiPost<RowQueryResultDto>(`/databases/${db.id}/query`, {
        viewId: view.id,
        chartPoint: { x: point.x, series: point.series },
        limit: 200,
        timeZone: timeZone(),
      }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={point.title || t('drilldown')}
        description={t('drillCount', { count: rows.data?.total ?? 0 })}
        data-testid="chart-drilldown"
      >
        <div className="max-h-[50vh] overflow-y-auto">
          {(rows.data?.rows ?? []).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpenRow(r.id)}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
              data-testid="drill-row"
            >
              {r.icon ? (
                <PageIcon icon={r.icon} size={14} />
              ) : (
                <FileText className="size-3.5 text-fg-subtle" />
              )}
              <span className={cn('truncate', !r.title && 'text-fg-subtle')}>
                {r.title || td('untitled')}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
