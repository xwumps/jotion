'use client';

import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { PluginKey } from '@tiptap/pm/state';
import {
  ArrowDownToLine,
  ArrowRightToLine,
  Columns3,
  PanelTop,
  PanelLeft,
  Rows3,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

const tableMenuKey = new PluginKey('jotion-table-menu');

function Btn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-8 min-w-8 items-center justify-center px-1.5 text-fg-muted hover:bg-hover [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

/** Werkzeugleiste für einfache Tabellen: Zeilen und Spalten, Kopfzeile und -spalte. */
export function TableMenu({ editor }: { editor: Editor }) {
  const t = useTranslations('contentBlocks.table');
  return (
    <BubbleMenu
      editor={editor}
      pluginKey={tableMenuKey}
      shouldShow={({ editor: e, state }) =>
        e.isEditable && state.selection.empty && e.isActive('table')
      }
      options={{ placement: 'top' }}
      className="flex overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-popover"
      ref={(el) => el?.setAttribute('data-testid', 'table-menu')}
    >
      <Btn label={t('addRow')} onClick={() => editor.chain().focus().addRowAfter().run()}>
        <ArrowDownToLine />
      </Btn>
      <Btn label={t('addColumn')} onClick={() => editor.chain().focus().addColumnAfter().run()}>
        <ArrowRightToLine />
      </Btn>
      <Btn label={t('deleteRow')} onClick={() => editor.chain().focus().deleteRow().run()}>
        <Rows3 />
      </Btn>
      <Btn label={t('deleteColumn')} onClick={() => editor.chain().focus().deleteColumn().run()}>
        <Columns3 />
      </Btn>
      <Btn label={t('headerRow')} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
        <PanelTop />
      </Btn>
      <Btn
        label={t('headerColumn')}
        onClick={() => editor.chain().focus().toggleHeaderColumn().run()}
      >
        <PanelLeft />
      </Btn>
      <Btn label={t('delete')} onClick={() => editor.chain().focus().deleteTable().run()}>
        <Trash2 />
      </Btn>
    </BubbleMenu>
  );
}
