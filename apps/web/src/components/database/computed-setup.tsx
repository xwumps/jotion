'use client';

import {
  rollupAggregationsFor,
  type DatabaseDto,
  type DatabaseSearchResultDto,
  type MemberDto,
  type PropertyDto,
  type RollupAggregation,
  type RowDto,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useQuery } from '@tanstack/react-query';
import { Database as DatabaseIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { apiGet } from '@/lib/api-client';
import { PageIcon } from '../page/page-icon';
import { Dialog, DialogContent } from '../ui/dialog';
import { FormulaEditor } from './formula-editor';
import { useDatabase } from './use-database';

export type ComputedType = 'relation' | 'rollup' | 'formula';

interface Props {
  db: DatabaseDto;
  type: ComputedType;
  /** Bestehendes Property (Bearbeiten) oder undefined (Anlegen) */
  prop?: PropertyDto;
  members: MemberDto[];
  sampleRows: RowDto[];
  onClose: () => void;
  onSubmit: (config: Record<string, unknown>) => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
const selectCls =
  'h-8 rounded-md border border-border bg-bg px-2 text-[14px] outline-none focus:border-accent';

/** Einrichten von Relation, Rollup und Formel (beim Anlegen und Bearbeiten). */
export function ComputedSetupDialog(props: Props) {
  const t = useTranslations('database');
  const titles: Record<ComputedType, string> = {
    relation: t('relation.title'),
    rollup: t('rollup.title'),
    formula: t('formula.title'),
  };
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent
        title={props.prop ? `${titles[props.type]}: ${props.prop.name}` : titles[props.type]}
        className={props.type === 'formula' ? 'max-w-[640px]' : undefined}
        data-testid="computed-setup"
      >
        {props.type === 'relation' && <RelationSetup {...props} />}
        {props.type === 'rollup' && <RollupSetup {...props} />}
        {props.type === 'formula' && <FormulaSetup {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function Buttons({
  onClose,
  disabled,
  onSave,
}: {
  onClose: () => void;
  disabled?: boolean;
  onSave: () => void;
}) {
  const t = useTranslations('database');
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="h-8 rounded-md px-3 text-[14px] hover:bg-hover"
      >
        {t('setup.cancel')}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onSave}
        className="h-8 rounded-md bg-accent px-3 text-[14px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        data-testid="computed-save"
      >
        {t('setup.save')}
      </button>
    </div>
  );
}

function RelationSetup({ db, prop, onClose, onSubmit }: Props) {
  const t = useTranslations('database');
  const cfg = (prop?.config ?? {}) as {
    targetDatabaseId?: string;
    twoWay?: boolean;
    limit?: 'one' | 'many';
  };
  const [target, setTarget] = useState<string | null>(cfg.targetDatabaseId ?? null);
  const [twoWay, setTwoWay] = useState(cfg.twoWay ?? false);
  const [limit, setLimit] = useState<'one' | 'many'>(cfg.limit ?? 'many');
  const [reverseName, setReverseName] = useState(db.title || '');
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['dbSearch', db.workspaceId, q],
    queryFn: () =>
      apiGet<DatabaseSearchResultDto[]>(
        `/workspaces/${db.workspaceId}/databases?q=${encodeURIComponent(q)}`,
      ),
    enabled: !prop,
  });
  return (
    <div className="flex flex-col gap-3">
      {!prop ? (
        <Field label={t('relation.target')}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('relation.searchDatabase')}
            className={selectCls}
            data-testid="relation-db-search"
          />
          <div className="max-h-[200px] overflow-y-auto rounded-md border border-border p-1">
            {(list.data ?? []).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setTarget(d.id)}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover',
                  target === d.id && 'bg-active',
                )}
                data-testid="relation-db-option"
                data-title={d.title}
              >
                {d.icon ? (
                  <PageIcon icon={d.icon} size={14} />
                ) : (
                  <DatabaseIcon className="size-3.5 text-fg-subtle" />
                )}
                <span className="flex-1 truncate">{d.title || t('untitled')}</span>
                {d.id === db.dataId && (
                  <span className="text-[12px] text-fg-subtle">{t('relation.self')}</span>
                )}
              </button>
            ))}
          </div>
        </Field>
      ) : null}
      <Field label={t('relation.limit')}>
        <select
          value={limit}
          onChange={(e) => setLimit(e.target.value as 'one' | 'many')}
          className={selectCls}
        >
          <option value="many">{t('relation.many')}</option>
          <option value="one">{t('relation.one')}</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 text-[14px]">
        <input
          type="checkbox"
          checked={twoWay}
          onChange={(e) => setTwoWay(e.target.checked)}
          className="size-4 accent-[var(--accent)]"
          data-testid="relation-two-way"
        />
        {t('relation.twoWay')}
      </label>
      {twoWay && !cfg.twoWay && (
        <Field label={t('relation.reverseName')}>
          <input
            value={reverseName}
            onChange={(e) => setReverseName(e.target.value)}
            className={selectCls}
          />
        </Field>
      )}
      <Buttons
        onClose={onClose}
        disabled={!target}
        onSave={() =>
          onSubmit({
            targetDatabaseId: target,
            twoWay,
            limit,
            ...(twoWay && !cfg.twoWay && reverseName.trim()
              ? { reverseName: reverseName.trim() }
              : {}),
          })
        }
      />
    </div>
  );
}

function RollupSetup({ db, prop, onClose, onSubmit }: Props) {
  const t = useTranslations('database');
  const cfg = (prop?.config ?? {}) as {
    relationPropertyId?: string;
    targetPropertyId?: string;
    aggregation?: RollupAggregation;
  };
  const relations = db.properties.filter((p) => p.type === 'relation');
  const [rel, setRel] = useState(cfg.relationPropertyId ?? relations[0]?.id ?? '');
  const relProp = relations.find((p) => p.id === rel);
  const targetDb = useDatabase(
    (relProp?.config as { targetDatabaseId?: string } | undefined)?.targetDatabaseId ?? '',
  );
  const targets = targetDb.data?.properties ?? [];
  const [target, setTarget] = useState(cfg.targetPropertyId ?? '');
  const targetProp = targets.find((p) => p.id === target) ?? targets[0];
  const aggs = targetProp ? rollupAggregationsFor(targetProp.type) : [];
  const [agg, setAgg] = useState<RollupAggregation>(cfg.aggregation ?? 'show_original');
  const aggValue = aggs.includes(agg) ? agg : 'show_original';
  if (!relations.length)
    return <p className="text-[14px] text-fg-muted">{t('rollup.noRelation')}</p>;
  return (
    <div className="flex flex-col gap-3">
      <Field label={t('rollup.relation')}>
        <select
          value={rel}
          onChange={(e) => setRel(e.target.value)}
          className={selectCls}
          data-testid="rollup-relation"
        >
          {relations.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('rollup.property')}>
        <select
          value={targetProp?.id ?? ''}
          onChange={(e) => setTarget(e.target.value)}
          className={selectCls}
          data-testid="rollup-property"
        >
          {targets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('rollup.calculate')}>
        <select
          value={aggValue}
          onChange={(e) => setAgg(e.target.value as RollupAggregation)}
          className={selectCls}
          data-testid="rollup-aggregation"
        >
          {aggs.map((a) => (
            <option key={a} value={a}>
              {t(`aggregations.${a}`)}
            </option>
          ))}
        </select>
      </Field>
      <Buttons
        onClose={onClose}
        disabled={!relProp || !targetProp}
        onSave={() =>
          onSubmit({
            relationPropertyId: rel,
            targetPropertyId: targetProp!.id,
            aggregation: aggValue,
          })
        }
      />
    </div>
  );
}

function FormulaSetup({ db, prop, members, sampleRows, onClose, onSubmit }: Props) {
  const initial = String((prop?.config as { expression?: string } | undefined)?.expression ?? '');
  const [expr, setExpr] = useState(initial);
  const [valid, setValid] = useState(initial.trim().length > 0);
  return (
    <div>
      <FormulaEditor
        db={db}
        selfId={prop?.id}
        initial={initial}
        members={members}
        sampleRows={sampleRows}
        onChange={(e, ok) => {
          setExpr(e);
          setValid(ok);
        }}
      />
      <Buttons onClose={onClose} disabled={!valid} onSave={() => onSubmit({ expression: expr })} />
    </div>
  );
}
