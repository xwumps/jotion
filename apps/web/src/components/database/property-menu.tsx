'use client';

import {
  CREATABLE_PROPERTY_TYPES,
  NUMBER_FORMATS,
  OPTION_COLORS,
  type CreatablePropertyType,
  type OptionColor,
  type PropertyDto,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import {
  ArrowDownWideNarrow,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpWideNarrow,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Filter,
  Pin,
  Plus,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { OptionChip } from './cells';
import { optionsOf, PROPERTY_ICONS } from './property-meta';

function Item({
  icon: Icon,
  children,
  onClick,
  destructive,
  right,
  testId,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  children: ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  right?: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover',
        destructive && 'text-[var(--c-red)]',
      )}
      data-testid={testId}
    >
      {Icon && <Icon className="size-4 shrink-0 opacity-80" />}
      <span className="flex-1 truncate">{children}</span>
      {right}
    </button>
  );
}

/** Typliste für neue Spalten und Typwechsel. */
export function TypeList({
  current,
  onPick,
}: {
  current?: string;
  onPick: (t: CreatablePropertyType) => void;
}) {
  const t = useTranslations('database');
  return (
    <div className="max-h-[320px] overflow-y-auto p-1" data-testid="type-list">
      {CREATABLE_PROPERTY_TYPES.map((type) => (
        <Item
          key={type}
          icon={PROPERTY_ICONS[type]}
          onClick={() => onPick(type)}
          right={current === type ? <span className="text-fg-subtle">✓</span> : null}
          testId={`type-${type}`}
        >
          {t(`types.${type}`)}
        </Item>
      ))}
    </div>
  );
}

export interface PropertyMenuActions {
  rename: (name: string) => void;
  changeType: (type: CreatablePropertyType) => void;
  updateConfig: (config: Record<string, unknown>) => void;
  sort: (direction: 'asc' | 'desc') => void;
  filter: () => void;
  hide: () => void;
  freeze: () => void;
  insert: (side: 'left' | 'right') => void;
  remove: () => void;
  undoConversion: () => void;
}

/** Menü einer Spalte (Kopfzeile der Tabelle). */
export function PropertyMenu({
  prop,
  canEditSchema,
  frozen,
  actions,
}: {
  prop: PropertyDto;
  canEditSchema: boolean;
  frozen: boolean;
  actions: PropertyMenuActions;
}) {
  const t = useTranslations('database');
  const [page, setPage] = useState<'main' | 'type' | 'options'>('main');
  const [name, setName] = useState(prop.name);
  const isTitle = prop.type === 'title';
  const hasOptions = ['select', 'multi_select', 'status'].includes(prop.type);

  if (page === 'type')
    return (
      <div className="w-[240px]">
        <Back onClick={() => setPage('main')}>{t('propertyMenu.type')}</Back>
        <TypeList
          current={prop.type}
          onPick={(type) => {
            if (type !== prop.type) actions.changeType(type);
            setPage('main');
          }}
        />
      </div>
    );
  if (page === 'options')
    return (
      <div className="w-[280px]">
        <Back onClick={() => setPage('main')}>{t('propertyMenu.options')}</Back>
        <OptionsEditor
          prop={prop}
          onChange={(options) => actions.updateConfig({ ...prop.config, options })}
        />
      </div>
    );

  return (
    <div className="w-[260px] p-1" data-testid="property-menu">
      {canEditSchema && (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== prop.name && actions.rename(name.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (name.trim() && name !== prop.name) actions.rename(name.trim());
            }
          }}
          aria-label={t('propertyMenu.name')}
          className="mb-1 h-8 w-full rounded-md border border-border bg-bg px-2 text-[14px] outline-none focus:border-accent"
          data-testid="property-name"
        />
      )}
      {canEditSchema && !isTitle && (
        <Item
          icon={PROPERTY_ICONS[prop.type]}
          onClick={() => setPage('type')}
          right={<ChevronRight className="size-4 text-fg-subtle" />}
          testId="property-type"
        >
          {t('propertyMenu.type')}: {t(`types.${prop.type}`)}
        </Item>
      )}
      {canEditSchema && hasOptions && (
        <Item
          icon={Plus}
          onClick={() => setPage('options')}
          right={<ChevronRight className="size-4 text-fg-subtle" />}
        >
          {t('propertyMenu.options')}
        </Item>
      )}
      {canEditSchema && prop.type === 'number' && (
        <label className="flex h-8 items-center gap-2 px-2 text-[14px]">
          <span className="flex-1">{t('propertyMenu.numberFormat')}</span>
          <select
            value={(prop.config as { format?: string }).format ?? 'number'}
            onChange={(e) => actions.updateConfig({ ...prop.config, format: e.target.value })}
            className="h-7 rounded-md border border-border bg-bg px-1 text-[13px]"
            data-testid="number-format"
          >
            {NUMBER_FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(`numberFormats.${f}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      {canEditSchema && prop.type === 'unique_id' && (
        <label className="flex h-8 items-center gap-2 px-2 text-[14px]">
          <span className="flex-1">{t('propertyMenu.prefix')}</span>
          <input
            defaultValue={(prop.config as { prefix?: string | null }).prefix ?? ''}
            maxLength={10}
            onBlur={(e) =>
              actions.updateConfig({ prefix: e.target.value.replace(/[^A-Za-z0-9]/g, '') || null })
            }
            className="h-7 w-[90px] rounded-md border border-border bg-bg px-1 text-[13px]"
          />
        </label>
      )}
      <div className="my-1 h-px bg-border" />
      <Item icon={ArrowUpWideNarrow} onClick={() => actions.sort('asc')} testId="sort-asc">
        {t('propertyMenu.sortAsc')}
      </Item>
      <Item icon={ArrowDownWideNarrow} onClick={() => actions.sort('desc')} testId="sort-desc">
        {t('propertyMenu.sortDesc')}
      </Item>
      <Item icon={Filter} onClick={actions.filter}>
        {t('propertyMenu.filter')}
      </Item>
      <div className="my-1 h-px bg-border" />
      <Item icon={Pin} onClick={actions.freeze}>
        {frozen ? t('propertyMenu.unfreeze') : t('propertyMenu.freeze')}
      </Item>
      {!isTitle && (
        <Item icon={EyeOff} onClick={actions.hide} testId="property-hide">
          {t('propertyMenu.hide')}
        </Item>
      )}
      {canEditSchema && (
        <>
          <Item icon={ArrowLeftToLine} onClick={() => actions.insert('left')}>
            {t('propertyMenu.insertLeft')}
          </Item>
          <Item icon={ArrowRightToLine} onClick={() => actions.insert('right')}>
            {t('propertyMenu.insertRight')}
          </Item>
          {!isTitle && (
            <Item icon={Undo2} onClick={actions.undoConversion}>
              {t('propertyMenu.undoType')}
            </Item>
          )}
          {!isTitle && (
            <Item icon={Trash2} destructive onClick={actions.remove} testId="property-delete">
              {t('propertyMenu.delete')}
            </Item>
          )}
        </>
      )}
    </div>
  );
}

function Back({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center gap-1 border-b border-border px-2 text-[13px] font-medium text-fg-muted hover:bg-hover"
    >
      <ChevronLeft className="size-4" />
      {children}
    </button>
  );
}

/** Optionen umbenennen, einfärben, löschen (Select, Multi-Select, Status). */
function OptionsEditor({
  prop,
  onChange,
}: {
  prop: PropertyDto;
  onChange: (options: ReturnType<typeof optionsOf>) => void;
}) {
  const t = useTranslations('database');
  const options = optionsOf(prop);
  const [newName, setNewName] = useState('');
  const isStatus = prop.type === 'status';
  const update = (i: number, patch: Partial<(typeof options)[number]>) =>
    onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div
      className="flex max-h-[360px] flex-col gap-1 overflow-y-auto p-2"
      data-testid="options-editor"
    >
      {options.map((o, i) => (
        <div key={o.id} className="flex items-center gap-1">
          <input
            defaultValue={o.name}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value !== o.name &&
              update(i, { name: e.target.value.trim() })
            }
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-1.5 text-[13px]"
            aria-label={t('propertyMenu.optionName')}
          />
          <select
            value={o.color}
            onChange={(e) => update(i, { color: e.target.value as OptionColor })}
            className="h-7 rounded-md border border-border bg-bg px-1 text-[12px]"
            aria-label={t('propertyMenu.color')}
          >
            {OPTION_COLORS.map((c) => (
              <option key={c} value={c}>
                {t(`colors.${c}`)}
              </option>
            ))}
          </select>
          {isStatus && (
            <select
              value={o.group}
              onChange={(e) => update(i, { group: e.target.value })}
              className="h-7 rounded-md border border-border bg-bg px-1 text-[12px]"
              aria-label={t('propertyMenu.group')}
            >
              {(['todo', 'in_progress', 'complete'] as const).map((g) => (
                <option key={g} value={g}>
                  {t(`statusGroups.${g}`)}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={isStatus && options.length <= 1}
            onClick={() => onChange(options.filter((_, j) => j !== i))}
            aria-label={t('propertyMenu.deleteOption')}
            className="rounded-md p-1 text-fg-subtle hover:bg-hover disabled:opacity-30"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name || options.some((o) => o.name.toLowerCase() === name.toLowerCase())) return;
          onChange([
            ...options,
            {
              id: crypto.randomUUID(),
              name,
              color: 'default',
              ...(isStatus ? { group: 'todo' } : {}),
            },
          ]);
          setNewName('');
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('propertyMenu.newOption')}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-1.5 text-[13px]"
        />
        <button type="submit" className="rounded-md px-2 text-[13px] hover:bg-hover">
          <Plus className="size-3.5" />
        </button>
      </form>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {options.map((o) => (
            <OptionChip key={o.id} name={o.name} color={o.color} />
          ))}
        </div>
      )}
    </div>
  );
}
