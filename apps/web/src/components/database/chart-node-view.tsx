'use client';

import { Chart } from '@jotion/editor';
import { cn } from '@jotion/ui';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { BarChart3, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { pageHref } from '@/lib/format';
import { useDatabase, useDatabaseActions, useMembers } from './use-database';
import { ChartBuilder } from './views/chart-builder';
import { chartConfigOf, ChartView } from './views/chart-view';
import type { DatabaseDto } from '@jotion/shared';

function ChartBlock({
  db,
  viewId,
  editable,
}: {
  db: DatabaseDto;
  viewId: string;
  editable: boolean;
}) {
  const t = useTranslations('charts');
  const members = useMembers(db.workspaceId);
  const actions = useDatabaseActions(db);
  const view = db.views.find((v) => v.id === viewId);
  if (!view)
    return <span className="flex h-[30px] items-center gap-2 text-fg-subtle">{t('missing')}</span>;
  const canEdit = editable && db.canEdit && !db.locked;
  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-border p-3"
      data-testid="chart-block"
    >
      <div className="flex items-center gap-2 text-[14px]">
        <BarChart3 className="size-4 text-fg-subtle" />
        <Link
          href={pageHref(db.workspaceId, db.id)}
          className="truncate font-medium hover:underline"
        >
          {db.title || '—'}
        </Link>
        <span className="truncate text-fg-subtle">{view.name}</span>
        {canEdit && (
          <div className="ml-auto">
            <ChartBuilder
              db={db}
              cfg={chartConfigOf(view)}
              onChange={(chart) => actions.updateView.mutate({ id: view.id, config: { chart } })}
            />
          </div>
        )}
      </div>
      <ChartView
        db={db}
        view={view}
        members={members.data ?? []}
        editable={false}
        embedded
        onOpenRow={(id) => window.location.assign(pageHref(db.workspaceId, id))}
        saveConfig={() => {}}
      />
    </div>
  );
}

/** Diagramm-Block im Editor: Chart-Ansicht einer Datenbank. */
function ChartNodeView({ node, selected, editor }: NodeViewProps) {
  const t = useTranslations('database');
  const id = node.attrs.databaseId as string | null;
  const viewId = node.attrs.viewId as string | null;
  const q = useDatabase(id ?? '');
  return (
    <NodeViewWrapper
      data-type="chart"
      className={cn('my-1 rounded-md', selected && 'ProseMirror-selectednode')}
      contentEditable={false}
    >
      {id && viewId && q.data ? (
        <ChartBlock db={q.data} viewId={viewId} editable={editor.isEditable} />
      ) : q.isError || !id ? (
        <span className="flex h-[30px] items-center gap-2 px-0.5 text-fg-subtle">
          <Lock className="size-4" />
          {t('noAccess')}
        </span>
      ) : (
        <div className="h-24" aria-busy="true" />
      )}
    </NodeViewWrapper>
  );
}

export const ChartNode = Chart.extend({
  addNodeView: () =>
    ReactNodeViewRenderer(ChartNodeView, {
      stopEvent: ({ event }) =>
        !(event.target as HTMLElement | null)?.closest?.('[data-drag-handle]'),
      ignoreMutation: () => true,
    }),
});
