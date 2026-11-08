'use client';

import {
  CHART_DATE_RANGES,
  CHART_MEASURES,
  CHART_TYPES,
  DATE_BUCKETS,
  effectiveType,
  isGroupable,
  type ChartConfig,
  type ChartDateRange,
  type DatabaseDto,
  type PropertyDto,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';

const DATE_TYPES = ['date', 'created_time', 'last_edited_time'];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-h-8 items-center gap-2 px-2 text-[14px]">
      <span className="flex-1 truncate text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
const selectCls =
  'h-7 max-w-[160px] rounded-md border border-border bg-bg px-1 text-[13px] outline-none focus:border-accent';
function Heading({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-2 text-[12px] font-medium text-fg-subtle">{children}</div>;
}

/** Diagramm einrichten: Typ, Achsen, Wert, Serien, Sortierung, Zeitraum, Darstellung. */
export function ChartBuilder({
  db,
  cfg,
  onChange,
}: {
  db: DatabaseDto;
  cfg: ChartConfig;
  onChange: (c: ChartConfig) => void;
}) {
  const t = useTranslations('charts');
  const set = (patch: Partial<ChartConfig>) => onChange({ ...cfg, ...patch });
  const setDisplay = (patch: Partial<ChartConfig['display']>) =>
    set({ display: { ...cfg.display, ...patch } });
  const eff = (p: PropertyDto) => effectiveType(p.type, p.config);
  const axisProps = db.properties.filter((p) => isGroupable(eff(p)));
  const numberProps = db.properties.filter((p) => eff(p) === 'number');
  const dateProps = db.properties.filter((p) => DATE_TYPES.includes(eff(p)));
  const noAxes = ['kpi', 'progress_bar', 'progress_ring'].includes(cfg.type);
  const axisSelect = (key: 'x' | 'series', testId: string) => {
    const axis = cfg[key];
    const prop = axis ? db.properties.find((p) => p.id === axis.propertyId) : undefined;
    return (
      <>
        <Row label={key === 'x' ? t('xAxis') : t('series')}>
          <select
            value={axis?.propertyId ?? ''}
            onChange={(e) =>
              set({
                [key]: e.target.value
                  ? { propertyId: e.target.value, dateBucket: 'month', numberInterval: 10 }
                  : null,
              })
            }
            className={selectCls}
            data-testid={testId}
          >
            <option value="">{t('none')}</option>
            {axisProps.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Row>
        {axis && prop && DATE_TYPES.includes(eff(prop)) && (
          <Row label={t('bucket')}>
            <select
              value={axis.dateBucket}
              onChange={(e) => set({ [key]: { ...axis, dateBucket: e.target.value } })}
              className={selectCls}
              data-testid={`${testId}-bucket`}
            >
              {DATE_BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {t(`buckets.${b}`)}
                </option>
              ))}
            </select>
          </Row>
        )}
        {axis && prop && eff(prop) === 'number' && (
          <Row label={t('interval')}>
            <input
              type="number"
              defaultValue={axis.numberInterval}
              min={0.000001}
              onBlur={(e) =>
                Number(e.target.value) > 0 &&
                set({ [key]: { ...axis, numberInterval: Number(e.target.value) } })
              }
              className={cn(selectCls, 'w-[90px]')}
            />
          </Row>
        )}
      </>
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover"
          data-testid="chart-builder"
        >
          <SlidersHorizontal className="size-3.5" />
          {t('edit')}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-[320px] overflow-y-auto p-1">
        <Heading>{t('type')}</Heading>
        <div className="grid grid-cols-2 gap-1 px-1 pb-1">
          {CHART_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => set({ type })}
              className={cn(
                'h-8 rounded-md border px-2 text-left text-[13px] hover:bg-hover',
                cfg.type === type ? 'border-accent text-accent' : 'border-border text-fg-muted',
              )}
              data-testid="chart-type"
              data-type={type}
            >
              {t(`types.${type}`)}
            </button>
          ))}
        </div>
        {!noAxes && (
          <>
            <Heading>{t('axes')}</Heading>
            {axisSelect('x', 'chart-x')}
          </>
        )}
        <Heading>{t('value')}</Heading>
        <Row label={t('measure')}>
          <select
            value={cfg.y.measure}
            onChange={(e) =>
              set({ y: { ...cfg.y, measure: e.target.value as ChartConfig['y']['measure'] } })
            }
            className={selectCls}
            data-testid="chart-measure"
          >
            {CHART_MEASURES.map((m) => (
              <option key={m} value={m}>
                {t(`measures.${m}`)}
              </option>
            ))}
          </select>
        </Row>
        {cfg.y.measure !== 'count' && (
          <Row label={t('of')}>
            <select
              value={cfg.y.propertyId ?? ''}
              onChange={(e) => set({ y: { ...cfg.y, propertyId: e.target.value || null } })}
              className={selectCls}
              data-testid="chart-value-property"
            >
              <option value="">{t('choose')}</option>
              {(cfg.y.measure === 'count_unique' ? db.properties : numberProps).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Row>
        )}
        {!noAxes && cfg.type !== 'pie' && cfg.type !== 'donut' && (
          <>
            {axisSelect('series', 'chart-series')}
            {cfg.series && (
              <Row label={t('stack')}>
                <select
                  value={cfg.stack}
                  onChange={(e) => set({ stack: e.target.value as ChartConfig['stack'] })}
                  className={selectCls}
                >
                  {(['none', 'stacked', 'percent'] as const).map((s) => (
                    <option key={s} value={s}>
                      {t(`stacks.${s}`)}
                    </option>
                  ))}
                </select>
              </Row>
            )}
          </>
        )}
        {!noAxes && (
          <>
            <Row label={t('sort')}>
              <select
                value={cfg.sort}
                onChange={(e) => set({ sort: e.target.value as ChartConfig['sort'] })}
                className={selectCls}
                data-testid="chart-sort"
              >
                {(['x_asc', 'x_desc', 'y_asc', 'y_desc'] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`sorts.${s}`)}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t('topN')}>
              <input
                type="number"
                min={1}
                max={100}
                defaultValue={cfg.topN ?? ''}
                placeholder={t('all')}
                onBlur={(e) =>
                  set({
                    topN: e.target.value
                      ? Math.max(1, Math.min(100, Number(e.target.value)))
                      : null,
                  })
                }
                className={cn(selectCls, 'w-[90px]')}
              />
            </Row>
            <Row label={t('hideEmpty')}>
              <input
                type="checkbox"
                checked={cfg.hideEmpty}
                onChange={(e) => set({ hideEmpty: e.target.checked })}
                className="size-4"
              />
            </Row>
            <Row label={t('cumulative')}>
              <input
                type="checkbox"
                checked={cfg.cumulative}
                onChange={(e) => set({ cumulative: e.target.checked })}
                className="size-4"
              />
            </Row>
          </>
        )}
        {cfg.type.startsWith('progress') && (
          <Row label={t('target')}>
            <input
              type="number"
              defaultValue={cfg.target ?? ''}
              onBlur={(e) => set({ target: e.target.value ? Number(e.target.value) : null })}
              className={cn(selectCls, 'w-[90px]')}
              data-testid="chart-target"
            />
          </Row>
        )}

        <Heading>{t('dateRange')}</Heading>
        <Row label={t('dateProperty')}>
          <select
            value={cfg.dateFilter?.propertyId ?? ''}
            onChange={(e) =>
              set({
                dateFilter: e.target.value
                  ? {
                      propertyId: e.target.value,
                      range: cfg.dateFilter?.range ?? 'last_30_days',
                      from: null,
                      to: null,
                    }
                  : null,
              })
            }
            className={selectCls}
            data-testid="chart-date-property"
          >
            <option value="">{t('none')}</option>
            {dateProps.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Row>
        {cfg.dateFilter && (
          <>
            <Row label={t('range')}>
              <select
                value={cfg.dateFilter.range}
                onChange={(e) =>
                  set({
                    dateFilter: { ...cfg.dateFilter!, range: e.target.value as ChartDateRange },
                  })
                }
                className={selectCls}
                data-testid="chart-range"
              >
                {CHART_DATE_RANGES.map((r) => (
                  <option key={r} value={r}>
                    {t(`ranges.${r}`)}
                  </option>
                ))}
              </select>
            </Row>
            {cfg.dateFilter.range === 'fixed' && (
              <Row label={t('fromTo')}>
                <input
                  type="date"
                  value={cfg.dateFilter.from ?? ''}
                  onChange={(e) =>
                    set({ dateFilter: { ...cfg.dateFilter!, from: e.target.value || null } })
                  }
                  className={cn(selectCls, 'w-[120px]')}
                />
                <input
                  type="date"
                  value={cfg.dateFilter.to ?? ''}
                  onChange={(e) =>
                    set({ dateFilter: { ...cfg.dateFilter!, to: e.target.value || null } })
                  }
                  className={cn(selectCls, 'w-[120px]')}
                />
              </Row>
            )}
            {cfg.type === 'kpi' && (
              <Row label={t('compare')}>
                <input
                  type="checkbox"
                  checked={cfg.compare}
                  onChange={(e) => set({ compare: e.target.checked })}
                  className="size-4"
                  data-testid="chart-compare"
                />
              </Row>
            )}
          </>
        )}

        <Heading>{t('display')}</Heading>
        <Row label={t('palette')}>
          <select
            value={cfg.display.palette}
            onChange={(e) =>
              setDisplay({ palette: e.target.value as ChartConfig['display']['palette'] })
            }
            className={selectCls}
          >
            {(['jotion', 'pastel', 'vivid', 'mono'] as const).map((p) => (
              <option key={p} value={p}>
                {t(`palettes.${p}`)}
              </option>
            ))}
          </select>
        </Row>
        {(
          [
            ['optionColors', t('optionColors')],
            ['legend', t('legend')],
            ['dataLabels', t('dataLabels')],
            ['grid', t('grid')],
            ['smooth', t('smooth')],
          ] as const
        ).map(([key, label]) => (
          <Row key={key} label={label}>
            <input
              type="checkbox"
              checked={cfg.display[key]}
              onChange={(e) => setDisplay({ [key]: e.target.checked })}
              className="size-4"
            />
          </Row>
        ))}
        <Row label={t('xTitle')}>
          <input
            defaultValue={cfg.display.xTitle}
            onBlur={(e) => setDisplay({ xTitle: e.target.value })}
            className={cn(selectCls, 'w-[140px]')}
          />
        </Row>
        <Row label={t('yTitle')}>
          <input
            defaultValue={cfg.display.yTitle}
            onBlur={(e) => setDisplay({ yTitle: e.target.value })}
            className={cn(selectCls, 'w-[140px]')}
          />
        </Row>
        <Row label={t('height')}>
          <select
            value={cfg.display.height}
            onChange={(e) => setDisplay({ height: Number(e.target.value) })}
            className={selectCls}
          >
            {[200, 320, 480, 640].map((h) => (
              <option key={h} value={h}>
                {t(`heights.${h}`)}
              </option>
            ))}
          </select>
        </Row>
      </PopoverContent>
    </Popover>
  );
}
