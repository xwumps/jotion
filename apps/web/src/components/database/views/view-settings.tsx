'use client';

import {
  CALCULATIONS,
  calculationsFor,
  CARD_PREVIEWS,
  CARD_SIZES,
  CREATABLE_VIEW_TYPES,
  DATE_BUCKETS,
  effectiveType,
  isGroupable,
  type DatabaseDto,
  type GroupBy,
  type PropertyDto,
  type ViewConfig,
  type ViewDto,
  type ViewType,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import {
  BarChart3,
  CalendarDays,
  Eye,
  GanttChart,
  KanbanSquare,
  LayoutGrid,
  List,
  Lock,
  Settings2,
  Table2,
  Unlock,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { orderedProperties } from '../table-view';

export const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  table: Table2,
  board: KanbanSquare,
  list: List,
  gallery: LayoutGrid,
  calendar: CalendarDays,
  timeline: GanttChart,
  chart: BarChart3,
};

const DATE_TYPES = ['date', 'created_time', 'last_edited_time'];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex h-8 items-center gap-2 px-2 text-[14px]">
      <span className="flex-1 truncate text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  testId?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 max-w-[150px] rounded-md border border-border bg-bg px-1 text-[13px] outline-none focus:border-accent"
      data-testid={testId}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  checked,
  onChange,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 accent-[var(--accent)]"
      data-testid={testId}
    />
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-2 text-[12px] font-medium text-fg-subtle">{children}</div>;
}

/** Ansicht einrichten: Layout, Gruppierung, Karten, Kalender, Zeitleiste und Sperre. */
export function ViewSettings({
  db,
  view,
  editable,
  onLayout,
  saveConfig,
  onLock,
}: {
  db: DatabaseDto;
  view: ViewDto;
  editable: boolean;
  onLayout: (type: ViewType) => void;
  saveConfig: (patch: Partial<ViewConfig>) => void;
  onLock: (locked: boolean) => void;
}) {
  const t = useTranslations('views');
  const td = useTranslations('database');
  const cfg = view.config;
  const props = orderedProperties(db, cfg);
  const groupable = props.filter((p) => isGroupable(effectiveType(p.type, p.config)));
  const dates = props.filter((p) => DATE_TYPES.includes(p.type));
  const none = { value: '', label: t('none') };
  const nameOf = (p: PropertyDto) => ({ value: p.id, label: p.name });

  const groupSelect = (by: GroupBy | null, key: 'groupBy' | 'subGroupBy', testId: string) => {
    const prop = by ? db.properties.find((p) => p.id === by.propertyId) : undefined;
    return (
      <>
        <Row label={key === 'groupBy' ? t('groupBy') : t('subGroupBy')}>
          <Select
            value={by?.propertyId ?? ''}
            onChange={(id) =>
              saveConfig({
                [key]: id
                  ? {
                      propertyId: id,
                      hideEmpty: false,
                      dateBucket: 'month',
                      numberInterval: 10,
                      sort: 'manual',
                      order: [],
                      hidden: [],
                      collapsed: [],
                    }
                  : null,
              })
            }
            options={[
              ...(view.type === 'board' && key === 'groupBy' ? [] : [none]),
              ...groupable.map(nameOf),
            ]}
            testId={testId}
          />
        </Row>
        {by && prop && DATE_TYPES.includes(prop.type) && (
          <Row label={t('dateBucket')}>
            <Select
              value={by.dateBucket}
              onChange={(v) =>
                saveConfig({ [key]: { ...by, dateBucket: v as GroupBy['dateBucket'] } })
              }
              options={DATE_BUCKETS.map((b) => ({ value: b, label: t(`buckets.${b}`) }))}
            />
          </Row>
        )}
        {by && prop?.type === 'number' && (
          <Row label={t('numberInterval')}>
            <input
              type="number"
              min={0.000001}
              defaultValue={by.numberInterval}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (n > 0 && n !== by.numberInterval)
                  saveConfig({ [key]: { ...by, numberInterval: n } });
              }}
              className="h-7 w-[90px] rounded-md border border-border bg-bg px-1 text-[13px] outline-none"
            />
          </Row>
        )}
        {by && (
          <>
            <Row label={t('groupSort')}>
              <Select
                value={by.sort}
                onChange={(v) => saveConfig({ [key]: { ...by, sort: v as GroupBy['sort'] } })}
                options={(['manual', 'asc', 'desc'] as const).map((v) => ({
                  value: v,
                  label: t(`groupSorts.${v}`),
                }))}
              />
            </Row>
            <Row label={t('hideEmpty')}>
              <Toggle
                checked={by.hideEmpty}
                onChange={(v) => saveConfig({ [key]: { ...by, hideEmpty: v } })}
              />
            </Row>
          </>
        )}
      </>
    );
  };

  const board = {
    cardPreview: 'none',
    previewPropertyId: null,
    cardSize: 'medium',
    fitImage: false,
    colorColumns: true,
    columnCalculation: null,
    ...cfg.board,
  };
  const gallery = {
    cardPreview: 'cover',
    previewPropertyId: null,
    cardSize: 'medium',
    fitImage: false,
    ...cfg.gallery,
  };
  const calendar = { datePropertyId: null, mode: 'month', showWeekends: true, ...cfg.calendar };
  const timeline = {
    startPropertyId: null,
    endPropertyId: null,
    zoom: 'week',
    showTable: true,
    tableWidth: 280,
    ...cfg.timeline,
  };
  const cards = view.type === 'board' ? board : view.type === 'gallery' ? gallery : null;
  const saveCards = (patch: Record<string, unknown>) =>
    view.type === 'board'
      ? saveConfig({ board: { ...board, ...patch } as ViewConfig['board'] })
      : saveConfig({ gallery: { ...gallery, ...patch } as ViewConfig['gallery'] });
  const cardLayout = view.type !== 'table';
  const shown = new Set(cfg.cardProperties ?? []);
  const numeric = props.filter((p) => calculationsFor(effectiveType(p.type, p.config)).length > 1);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('settings')}
          className="flex h-7 items-center rounded-md px-1.5 hover:bg-hover"
          data-testid="view-settings"
        >
          <Settings2 className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-[300px] overflow-y-auto p-1">
        <Heading>{t('layout')}</Heading>
        <div className="grid grid-cols-3 gap-1 px-1 pb-1">
          {CREATABLE_VIEW_TYPES.map((type) => {
            const Icon = VIEW_ICONS[type];
            return (
              <button
                key={type}
                type="button"
                disabled={!editable || db.locked}
                onClick={() => type !== view.type && onLayout(type)}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-[12px] hover:bg-hover disabled:opacity-60',
                  type === view.type ? 'border-accent text-accent' : 'border-border text-fg-muted',
                )}
                data-testid="layout-option"
                data-layout={type}
              >
                <Icon className="size-4" />
                {t(`layouts.${type}`)}
              </button>
            );
          })}
        </div>
        <fieldset disabled={!editable || db.locked} className="disabled:opacity-60">
          {view.type !== 'calendar' && view.type !== 'chart' && (
            <>
              <Heading>{t('grouping')}</Heading>
              {groupSelect(cfg.groupBy, 'groupBy', 'group-by')}
              {view.type === 'board' &&
                cfg.groupBy &&
                groupSelect(cfg.subGroupBy, 'subGroupBy', 'sub-group-by')}
            </>
          )}
          {view.type === 'calendar' && (
            <>
              <Heading>{t('layouts.calendar')}</Heading>
              <Row label={t('dateProperty')}>
                <Select
                  value={calendar.datePropertyId ?? ''}
                  onChange={(v) =>
                    saveConfig({
                      calendar: {
                        ...calendar,
                        datePropertyId: v || null,
                      } as ViewConfig['calendar'],
                    })
                  }
                  options={[none, ...dates.map(nameOf)]}
                  testId="calendar-date-property"
                />
              </Row>
              <Row label={t('showWeekends')}>
                <Toggle
                  checked={calendar.showWeekends}
                  onChange={(v) =>
                    saveConfig({
                      calendar: { ...calendar, showWeekends: v } as ViewConfig['calendar'],
                    })
                  }
                />
              </Row>
            </>
          )}
          {view.type === 'timeline' && (
            <>
              <Heading>{t('layouts.timeline')}</Heading>
              <Row label={t('startProperty')}>
                <Select
                  value={timeline.startPropertyId ?? ''}
                  onChange={(v) =>
                    saveConfig({
                      timeline: {
                        ...timeline,
                        startPropertyId: v || null,
                      } as ViewConfig['timeline'],
                    })
                  }
                  options={[none, ...dates.map(nameOf)]}
                />
              </Row>
              <Row label={t('endProperty')}>
                <Select
                  value={timeline.endPropertyId ?? ''}
                  onChange={(v) =>
                    saveConfig({
                      timeline: { ...timeline, endPropertyId: v || null } as ViewConfig['timeline'],
                    })
                  }
                  options={[{ value: '', label: t('sameProperty') }, ...dates.map(nameOf)]}
                />
              </Row>
              <Row label={t('showTable')}>
                <Toggle
                  checked={timeline.showTable}
                  onChange={(v) =>
                    saveConfig({
                      timeline: { ...timeline, showTable: v } as ViewConfig['timeline'],
                    })
                  }
                />
              </Row>
            </>
          )}
          {cards && (
            <>
              <Heading>{t('cards')}</Heading>
              <Row label={t('cardPreview')}>
                <Select
                  value={cards.cardPreview}
                  onChange={(v) => saveCards({ cardPreview: v })}
                  options={CARD_PREVIEWS.map((p) => ({ value: p, label: t(`previews.${p}`) }))}
                  testId="card-preview"
                />
              </Row>
              {cards.cardPreview === 'files' && (
                <Row label={t('previewProperty')}>
                  <Select
                    value={cards.previewPropertyId ?? ''}
                    onChange={(v) => saveCards({ previewPropertyId: v || null })}
                    options={[none, ...props.filter((p) => p.type === 'files').map(nameOf)]}
                  />
                </Row>
              )}
              <Row label={t('cardSize')}>
                <Select
                  value={cards.cardSize}
                  onChange={(v) => saveCards({ cardSize: v })}
                  options={CARD_SIZES.map((s) => ({ value: s, label: t(`sizes.${s}`) }))}
                  testId="card-size"
                />
              </Row>
              <Row label={t('fitImage')}>
                <Toggle checked={cards.fitImage} onChange={(v) => saveCards({ fitImage: v })} />
              </Row>
              {view.type === 'board' && (
                <>
                  <Row label={t('colorColumns')}>
                    <Toggle
                      checked={board.colorColumns}
                      onChange={(v) => saveCards({ colorColumns: v })}
                    />
                  </Row>
                  <Row label={t('columnCalculation')}>
                    <Select
                      value={
                        board.columnCalculation
                          ? `${board.columnCalculation.propertyId}:${board.columnCalculation.fn}`
                          : ''
                      }
                      onChange={(v) => {
                        if (!v) return saveCards({ columnCalculation: null });
                        const [propertyId, fn] = v.split(':');
                        saveCards({ columnCalculation: { propertyId, fn } });
                      }}
                      options={[
                        none,
                        ...numeric.flatMap((p) =>
                          calculationsFor(effectiveType(p.type, p.config))
                            .filter(
                              (fn) =>
                                fn !== 'count_all' &&
                                (CALCULATIONS as readonly string[]).includes(fn),
                            )
                            .map((fn) => ({
                              value: `${p.id}:${fn}`,
                              label: `${p.name}: ${td(`calc.fn.${fn}`)}`,
                            })),
                        ),
                      ]}
                    />
                  </Row>
                </>
              )}
            </>
          )}
          {cardLayout && (
            <>
              <Heading>{t('visibleProperties')}</Heading>
              {props
                .filter((p) => p.type !== 'title')
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      const next = new Set(shown);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      saveConfig({ cardProperties: [...next] });
                    }}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
                    data-testid="card-property"
                    data-property={p.name}
                  >
                    <span className="flex-1 truncate">{p.name}</span>
                    <Eye
                      className={cn(
                        'size-4',
                        shown.has(p.id) ? 'text-fg' : 'text-fg-subtle opacity-40',
                      )}
                    />
                  </button>
                ))}
            </>
          )}
        </fieldset>
        {editable && (
          <>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={() => onLock(!db.locked)}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
              data-testid="lock-database"
            >
              {db.locked ? <Unlock className="size-4" /> : <Lock className="size-4" />}
              <span className="flex-1">{db.locked ? t('unlock') : t('lock')}</span>
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
