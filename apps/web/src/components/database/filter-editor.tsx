'use client';

import {
  DATE_RANGES,
  isSortable,
  operatorsFor,
  RELATIVE_DATES,
  type DateOperand,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterOperator,
  type MemberDto,
  type PropertyDto,
  type RelativeDate,
  type SortSpec,
} from '@jotion/shared';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { optionsOf } from './property-meta';

const selectCls =
  'h-7 min-w-0 rounded-md border border-border bg-bg px-1.5 text-[13px] text-fg outline-none focus:border-accent';

const NO_VALUE: FilterOperator[] = ['is_empty', 'is_not_empty'];

function defaultCondition(prop: PropertyDto): FilterCondition {
  const op = operatorsFor(prop.type)[0]!;
  const value =
    prop.type === 'checkbox'
      ? true
      : prop.type === 'date' || prop.type === 'created_time' || prop.type === 'last_edited_time'
        ? ({ kind: 'relative', preset: 'today' } satisfies DateOperand)
        : undefined;
  return { type: 'condition', propertyId: prop.id, operator: op, value };
}

/** Zählt Bedingungen (für das Abzeichen am Filter-Knopf). */
export function countConditions(g: FilterGroup | null | undefined): number {
  if (!g) return 0;
  return g.children.reduce((n, c) => n + (c.type === 'group' ? countConditions(c) : 1), 0);
}

const filterable = (props: PropertyDto[]) => props.filter((p) => operatorsFor(p.type).length > 0);

/**
 * Filter mit UND/ODER: Bedingungen auf oberster Ebene und Filtergruppen (eine Ebene tiefer).
 * Jede Änderung wird sofort in der Ansicht gespeichert.
 */
export function FilterEditor({
  props,
  members,
  filter,
  onChange,
}: {
  props: PropertyDto[];
  members: MemberDto[];
  filter: FilterGroup | null;
  onChange: (f: FilterGroup | null) => void;
}) {
  const t = useTranslations('database');
  const root: FilterGroup = filter ?? { type: 'group', op: 'and', children: [] };
  const usable = filterable(props);
  const set = (g: FilterGroup) => onChange(g.children.length ? g : null);

  return (
    <div className="flex w-[min(640px,92vw)] flex-col gap-2 p-3" data-testid="filter-editor">
      {root.children.length === 0 && (
        <p className="text-[13px] text-fg-subtle">{t('filter.empty')}</p>
      )}
      <GroupRows group={root} props={usable} members={members} depth={1} onChange={set} />
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() =>
            usable[0] && set({ ...root, children: [...root.children, defaultCondition(usable[0])] })
          }
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover"
          data-testid="add-filter"
        >
          <Plus className="size-3.5" />
          {t('filter.add')}
        </button>
        <button
          type="button"
          onClick={() =>
            usable[0] &&
            set({
              ...root,
              children: [
                ...root.children,
                { type: 'group', op: 'and', children: [defaultCondition(usable[0])] },
              ],
            })
          }
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover"
          data-testid="add-filter-group"
        >
          <Plus className="size-3.5" />
          {t('filter.addGroup')}
        </button>
        {root.children.length > 0 && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="ml-auto flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover"
          >
            <Trash2 className="size-3.5" />
            {t('filter.clear')}
          </button>
        )}
      </div>
    </div>
  );
}

function GroupRows({
  group,
  props,
  members,
  depth,
  onChange,
}: {
  group: FilterGroup;
  props: PropertyDto[];
  members: MemberDto[];
  depth: number;
  onChange: (g: FilterGroup) => void;
}) {
  const t = useTranslations('database');
  const replace = (i: number, node: FilterNode | null) => {
    const children = [...group.children];
    if (node) children[i] = node;
    else children.splice(i, 1);
    onChange({ ...group, children });
  };
  return (
    <div className="flex flex-col gap-1.5">
      {group.children.map((child, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <div className="w-[64px] shrink-0 pt-0.5 text-[13px] text-fg-muted">
            {i === 0 ? (
              t('filter.where')
            ) : i === 1 ? (
              <select
                value={group.op}
                onChange={(e) => onChange({ ...group, op: e.target.value as 'and' | 'or' })}
                className={selectCls}
                aria-label={t('filter.combine')}
                data-testid="filter-op"
              >
                <option value="and">{t('filter.and')}</option>
                <option value="or">{t('filter.or')}</option>
              </select>
            ) : (
              <span className="pl-1.5">{t(`filter.${group.op}`)}</span>
            )}
          </div>
          {child.type === 'group' ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md border border-border bg-hover p-2">
              <GroupRows
                group={child}
                props={props}
                members={members}
                depth={depth + 1}
                onChange={(g) => replace(i, g.children.length ? g : null)}
              />
              {depth < 2 && props[0] && (
                <button
                  type="button"
                  onClick={() =>
                    replace(i, {
                      ...child,
                      children: [...child.children, defaultCondition(props[0]!)],
                    })
                  }
                  className="flex h-7 w-fit items-center gap-1 rounded-md px-2 text-[13px] text-fg-muted hover:bg-active"
                >
                  <Plus className="size-3.5" />
                  {t('filter.add')}
                </button>
              )}
            </div>
          ) : (
            <ConditionRow
              cond={child}
              props={props}
              members={members}
              onChange={(c) => replace(i, c)}
            />
          )}
          <button
            type="button"
            onClick={() => replace(i, null)}
            aria-label={t('filter.remove')}
            className="mt-0.5 rounded-md p-1 text-fg-subtle hover:bg-hover hover:text-fg"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ConditionRow({
  cond,
  props,
  members,
  onChange,
}: {
  cond: FilterCondition;
  props: PropertyDto[];
  members: MemberDto[];
  onChange: (c: FilterCondition) => void;
}) {
  const t = useTranslations('database');
  const prop = props.find((p) => p.id === cond.propertyId);
  const ops = prop ? operatorsFor(prop.type) : [];
  return (
    <div
      className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
      data-testid="filter-condition"
    >
      <select
        value={cond.propertyId}
        onChange={(e) => {
          const p = props.find((x) => x.id === e.target.value);
          if (p) onChange(defaultCondition(p));
        }}
        className={selectCls}
        aria-label={t('filter.property')}
        data-testid="filter-property"
      >
        {!prop && <option value={cond.propertyId}>{t('filter.deletedProperty')}</option>}
        {props.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {prop && (
        <select
          value={cond.operator}
          onChange={(e) => {
            const operator = e.target.value as FilterOperator;
            const keepValue =
              !NO_VALUE.includes(operator) &&
              (operator === 'is_within') === (cond.operator === 'is_within');
            onChange({
              ...cond,
              operator,
              value: keepValue
                ? cond.value
                : operator === 'is_within'
                  ? 'past_week'
                  : defaultCondition(prop).value,
            });
          }}
          className={selectCls}
          aria-label={t('filter.operator')}
          data-testid="filter-operator"
        >
          {ops.map((o) => (
            <option key={o} value={o}>
              {t(`operators.${prop.type === 'checkbox' ? 'is_checkbox' : o}`)}
            </option>
          ))}
        </select>
      )}
      {prop && !NO_VALUE.includes(cond.operator) && (
        <ValueInput prop={prop} cond={cond} members={members} onChange={onChange} />
      )}
    </div>
  );
}

function ValueInput({
  prop,
  cond,
  members,
  onChange,
}: {
  prop: PropertyDto;
  cond: FilterCondition;
  members: MemberDto[];
  onChange: (c: FilterCondition) => void;
}) {
  const t = useTranslations('database');
  const set = (value: FilterCondition['value']) => onChange({ ...cond, value });
  switch (prop.type) {
    case 'select':
    case 'status':
    case 'multi_select':
      return (
        <select
          value={typeof cond.value === 'string' ? cond.value : ''}
          onChange={(e) => set(e.target.value || undefined)}
          className={selectCls}
          aria-label={t('filter.value')}
          data-testid="filter-value"
        >
          <option value="">{t('filter.choose')}</option>
          {optionsOf(prop).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return (
        <select
          value={typeof cond.value === 'string' ? cond.value : ''}
          onChange={(e) => set(e.target.value || undefined)}
          className={selectCls}
          aria-label={t('filter.value')}
          data-testid="filter-value"
        >
          <option value="">{t('filter.choose')}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
      );
    case 'checkbox':
      return (
        <select
          value={cond.value === false ? 'false' : 'true'}
          onChange={(e) => set(e.target.value === 'true')}
          className={selectCls}
          aria-label={t('filter.value')}
          data-testid="filter-value"
        >
          <option value="true">{t('filter.checked')}</option>
          <option value="false">{t('filter.unchecked')}</option>
        </select>
      );
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return <DateOperandInput cond={cond} onChange={set} />;
    default:
      return (
        <DebouncedInput
          type={prop.type === 'number' || prop.type === 'unique_id' ? 'number' : 'text'}
          value={cond.value === undefined || cond.value === null ? '' : String(cond.value)}
          onChange={(s) =>
            set(
              prop.type === 'number' || prop.type === 'unique_id'
                ? s.trim() === ''
                  ? undefined
                  : Number(s)
                : s,
            )
          }
        />
      );
  }
}

function DateOperandInput({
  cond,
  onChange,
}: {
  cond: FilterCondition;
  onChange: (v: FilterCondition['value']) => void;
}) {
  const t = useTranslations('database');
  if (cond.operator === 'is_within') {
    return (
      <select
        value={typeof cond.value === 'string' ? cond.value : 'past_week'}
        onChange={(e) => onChange(e.target.value)}
        className={selectCls}
        aria-label={t('filter.value')}
        data-testid="filter-value"
      >
        {DATE_RANGES.map((r) => (
          <option key={r} value={r}>
            {t(`dateRanges.${r}`)}
          </option>
        ))}
      </select>
    );
  }
  const v = (cond.value ?? { kind: 'relative', preset: 'today' }) as DateOperand;
  return (
    <>
      <select
        value={v.kind === 'exact' ? 'exact' : v.preset}
        onChange={(e) =>
          onChange(
            e.target.value === 'exact'
              ? { kind: 'exact', date: new Date().toISOString().slice(0, 10) }
              : { kind: 'relative', preset: e.target.value as RelativeDate },
          )
        }
        className={selectCls}
        aria-label={t('filter.value')}
        data-testid="filter-value"
      >
        {RELATIVE_DATES.map((r) => (
          <option key={r} value={r}>
            {t(`relativeDates.${r}`)}
          </option>
        ))}
        <option value="exact">{t('relativeDates.exact')}</option>
      </select>
      {v.kind === 'exact' && (
        <input
          type="date"
          value={v.date}
          onChange={(e) => e.target.value && onChange({ kind: 'exact', date: e.target.value })}
          className={selectCls}
          aria-label={t('filter.date')}
        />
      )}
    </>
  );
}

function DebouncedInput({
  value,
  type,
  onChange,
}: {
  value: string;
  type: 'text' | 'number';
  onChange: (v: string) => void;
}) {
  const t = useTranslations('database');
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <input
      type={type}
      value={draft}
      onChange={(e) => {
        const s = e.target.value;
        setDraft(s);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => cb.current(s), 300);
      }}
      placeholder={t('filter.valuePlaceholder')}
      className={`${selectCls} w-[140px]`}
      aria-label={t('filter.value')}
      data-testid="filter-value"
    />
  );
}

/** Mehrstufige Sortierung. */
export function SortEditor({
  props,
  sorts,
  onChange,
}: {
  props: PropertyDto[];
  sorts: SortSpec[];
  onChange: (s: SortSpec[]) => void;
}) {
  const t = useTranslations('database');
  const usable = props.filter((p) => isSortable(p.type));
  const unused = usable.filter((p) => !sorts.some((s) => s.propertyId === p.id));
  const move = (i: number, d: -1 | 1) => {
    const next = [...sorts];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    onChange(next);
  };
  return (
    <div className="flex w-[min(460px,92vw)] flex-col gap-1.5 p-3" data-testid="sort-editor">
      {sorts.length === 0 && <p className="text-[13px] text-fg-subtle">{t('sort.empty')}</p>}
      {sorts.map((s, i) => (
        <div key={s.propertyId} className="flex items-center gap-1.5" data-testid="sort-row">
          <select
            value={s.propertyId}
            onChange={(e) => {
              const next = [...sorts];
              next[i] = { ...s, propertyId: e.target.value };
              onChange(next);
            }}
            className={selectCls}
            aria-label={t('sort.property')}
          >
            {usable
              .filter((p) => p.id === s.propertyId || !sorts.some((x) => x.propertyId === p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <select
            value={s.direction}
            onChange={(e) => {
              const next = [...sorts];
              next[i] = { ...s, direction: e.target.value as 'asc' | 'desc' };
              onChange(next);
            }}
            className={selectCls}
            aria-label={t('sort.direction')}
            data-testid="sort-direction"
          >
            <option value="asc">{t('sort.asc')}</option>
            <option value="desc">{t('sort.desc')}</option>
          </select>
          <button
            type="button"
            disabled={i === 0}
            onClick={() => move(i, -1)}
            aria-label={t('sort.up')}
            className="rounded-md p-1 text-fg-subtle hover:bg-hover disabled:opacity-30"
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            type="button"
            disabled={i === sorts.length - 1}
            onClick={() => move(i, 1)}
            aria-label={t('sort.down')}
            className="rounded-md p-1 text-fg-subtle hover:bg-hover disabled:opacity-30"
          >
            <ArrowDown className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChange(sorts.filter((_, j) => j !== i))}
            aria-label={t('sort.remove')}
            className="ml-auto rounded-md p-1 text-fg-subtle hover:bg-hover hover:text-fg"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      {unused[0] && (
        <button
          type="button"
          onClick={() => onChange([...sorts, { propertyId: unused[0]!.id, direction: 'asc' }])}
          className="flex h-7 w-fit items-center gap-1 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover"
          data-testid="add-sort"
        >
          <Plus className="size-3.5" />
          {t('sort.add')}
        </button>
      )}
    </div>
  );
}
