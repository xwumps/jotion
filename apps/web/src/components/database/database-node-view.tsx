'use client';

import { Database } from '@jotion/editor';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { cn } from '@jotion/ui';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DatabaseView } from './database-view';

/** Inline-Datenbank im Editor. Ereignisse bleiben in der Ansicht (keine Eingaben in ProseMirror). */
function DatabaseNodeView({ node, selected, editor }: NodeViewProps) {
  const t = useTranslations('database');
  const id = node.attrs.databaseId as string | null;
  return (
    <NodeViewWrapper
      data-type="database"
      className={cn('jt-database my-1 rounded-md', selected && 'ProseMirror-selectednode')}
      contentEditable={false}
    >
      {id ? (
        <DatabaseView databaseId={id} mode="inline" editable={editor.isEditable} />
      ) : (
        <span className="flex h-[30px] items-center gap-2 px-0.5 text-fg-subtle">
          <Lock className="size-4" />
          {t('noAccess')}
        </span>
      )}
    </NodeViewWrapper>
  );
}

export const DatabaseNode = Database.extend({
  addNodeView: () =>
    ReactNodeViewRenderer(DatabaseNodeView, {
      // Tastatur, Maus und Ziehen innerhalb der Tabelle nicht an den Editor weitergeben
      stopEvent: ({ event }) =>
        !(event.target as HTMLElement | null)?.closest?.('[data-drag-handle]'),
      ignoreMutation: () => true,
    }),
});
