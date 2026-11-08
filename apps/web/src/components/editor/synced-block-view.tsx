'use client';

import { jotionExtensions, parseSyncedToken, SyncedBlock, syncedToken } from '@jotion/editor';
import type { SyncedBlockInfoDto } from '@jotion/shared';
import { Extension } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { Plugin } from '@tiptap/pm/state';
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from '@tiptap/react';
import { useQuery } from '@tanstack/react-query';
import { Copy, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiGet } from '@/lib/api-client';
import { pageHref } from '@/lib/format';
import { userColor } from '@/lib/presence-store';
import { useMe } from '../app/providers';
import { openPageSession, type PageSession } from './collab-client';
import { useEditorPage } from './editor-context';
import { nodeViewOverrides } from './node-views';
import { waitForInitialContent } from './page-editor';

/** Verschachtelte Synced Blocks werden nicht erneut eingebettet (Endlosschleife vermeiden) */
const InsideSynced = createContext(false);

function SyncedBlockView({ node, editor, selected }: NodeViewProps) {
  const t = useTranslations('synced');
  const nested = useContext(InsideSynced);
  const { workspaceId } = useEditorPage();
  const pageId = node.attrs.pageId as string | null;
  const info = useQuery({
    queryKey: ['synced', pageId],
    queryFn: () => apiGet<SyncedBlockInfoDto>(`/pages/${pageId}/synced`),
    enabled: !!pageId && !nested,
    retry: false,
  });
  const copy = async () => {
    if (!pageId) return;
    await navigator.clipboard.writeText(syncedToken(pageId));
    toast.success(t('copied'));
  };

  let body: React.ReactNode;
  if (nested) body = <p className="text-[13px] text-fg-muted">{t('nested')}</p>;
  else if (info.isError || !pageId)
    body = (
      <p className="text-[13px] text-fg-muted" data-testid="synced-unavailable">
        {t('unavailable')}
      </p>
    );
  else if (!info.data) body = <div className="h-6" aria-busy="true" />;
  else
    body = (
      <InsideSynced.Provider value>
        <SyncedEditor pageId={pageId} editable={info.data.canEdit && editor.isEditable} />
      </InsideSynced.Provider>
    );

  return (
    <NodeViewWrapper
      className="jt-synced group relative my-1 rounded-md border-2 border-transparent px-2 py-1 hover:border-[var(--c-orange)]/60 data-[selected=true]:border-[var(--c-orange)]"
      data-selected={selected}
      data-testid="synced-block"
      data-page-id={pageId ?? ''}
    >
      <div
        contentEditable={false}
        className="absolute -top-3 right-2 z-10 hidden items-center gap-1 rounded-md border border-border bg-bg-elevated px-1.5 py-0.5 text-[12px] text-fg-muted shadow-sm group-hover:flex"
      >
        <RefreshCw className="size-3 text-[var(--c-orange)]" />
        {info.data && info.data.originId && (
          <Link href={pageHref(workspaceId, info.data.originId)} className="hover:underline">
            {t('origin', { title: info.data.originTitle || t('untitled') })}
          </Link>
        )}
        <button
          type="button"
          onClick={() => void copy()}
          className="ml-1 flex items-center gap-0.5 rounded px-1 hover:bg-hover"
          data-testid="synced-copy"
        >
          <Copy className="size-3" />
          {t('copy')}
        </button>
      </div>
      {body}
    </NodeViewWrapper>
  );
}

/** Eingebetteter Collab-Editor für den Inhalt des Synced Blocks */
function SyncedEditor({ pageId, editable }: { pageId: string; editable: boolean }) {
  const [session, setSession] = useState<PageSession | null>(null);
  useEffect(() => {
    let cancelled = false;
    const s = openPageSession(pageId);
    void waitForInitialContent(s).then(() => {
      if (!cancelled) setSession(s);
    });
    return () => {
      cancelled = true;
      setSession(null);
      s.destroy();
    };
  }, [pageId]);
  if (!session) return <div className="h-6" aria-busy="true" />;
  return <SyncedInner session={session} editable={editable} />;
}

function SyncedInner({ session, editable }: { session: PageSession; editable: boolean }) {
  const me = useMe();
  const extensions = useMemo(
    () =>
      jotionExtensions({
        collaborative: true,
        overrides: nodeViewOverrides,
        extra: [
          Collaboration.configure({ document: session.doc, field: 'default' }),
          CollaborationCaret.configure({
            provider: session.provider,
            user: { userId: me.user.id, name: me.user.name, color: userColor(me.user.id) },
          }),
        ],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.doc],
  );
  const editor = useEditor(
    {
      extensions,
      editable,
      immediatelyRender: false,
      editorProps: { attributes: { class: 'jt-editor', 'data-testid': 'synced-editor' } },
    },
    [extensions],
  );
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);
  return <EditorContent editor={editor} />;
}

export const SyncedNode = SyncedBlock.extend({
  addNodeView: () =>
    ReactNodeViewRenderer(SyncedBlockView, {
      // Eingaben im eingebetteten Editor nicht an den äußeren Editor weitergeben
      stopEvent: ({ event }) =>
        !(event.target as HTMLElement | null)?.closest?.('[data-drag-handle]'),
      ignoreMutation: () => true,
    }),
});

/** Einfügen eines kopierten Sync-Tokens erzeugt ein weiteres Vorkommen des Synced Blocks */
export const SyncedPaste = Extension.create({
  name: 'syncedPaste',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            const id = parseSyncedToken(event.clipboardData?.getData('text/plain') ?? '');
            if (!id) return false;
            editor.chain().focus().insertSyncedBlock(id).run();
            return true;
          },
        },
      }),
    ];
  },
});
