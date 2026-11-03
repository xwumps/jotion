'use client';

import type { DatabaseDto } from '@jotion/shared';
import { useTranslations } from 'next-intl';
import { ValueEditor } from './cells';
import { PROPERTY_ICONS } from './property-meta';
import { orderedProperties } from './table-view';
import { useDatabase, useDatabaseActions, useMembers, useRow } from './use-database';

/** Properties-Bereich einer Zeile (über dem Editor, in der Seitenansicht und im Peek). */
export function RowProperties({
  databaseId,
  rowId,
  editable,
}: {
  databaseId: string;
  rowId: string;
  editable: boolean;
}) {
  const db = useDatabase(databaseId);
  if (!db.data) return null;
  return <RowPropertiesInner db={db.data} rowId={rowId} editable={editable} />;
}

function RowPropertiesInner({
  db,
  rowId,
  editable,
}: {
  db: DatabaseDto;
  rowId: string;
  editable: boolean;
}) {
  const t = useTranslations('database');
  const row = useRow(db, rowId);
  const members = useMembers(db.workspaceId);
  const actions = useDatabaseActions(db);
  if (!row.data) return <div className="min-h-[40px]" aria-busy="true" />;
  const props = orderedProperties(db, db.views[0]?.config ?? ({ properties: [] } as never)).filter(
    (p) => p.type !== 'title',
  );
  const ctx = {
    workspaceId: db.workspaceId,
    members: members.data ?? [],
    actions,
    editable: editable && db.canEdit,
  };
  return (
    <section
      aria-label={t('row.properties')}
      className="mb-3 mt-1 flex flex-col border-b border-border pb-3"
      data-testid="row-properties"
    >
      {props.map((p) => {
        const Icon = PROPERTY_ICONS[p.type];
        return (
          <div
            key={p.id}
            className="flex min-h-[34px] items-start gap-1"
            data-testid="row-property"
          >
            <div className="flex h-[32px] w-[160px] shrink-0 items-center gap-1.5 px-1 text-[14px] text-fg-muted">
              <Icon className="size-4 shrink-0 opacity-70" />
              <span className="truncate">{p.name}</span>
            </div>
            <div className="min-w-0 flex-1">
              <ValueEditor prop={p} row={row.data} ctx={ctx} variant="panel" />
            </div>
          </div>
        );
      })}
    </section>
  );
}
