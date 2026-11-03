'use client';

import type { HocuspocusProvider } from '@hocuspocus/provider';
import { DOC_FRAGMENT, jotionExtensions } from '@jotion/editor';
import type { PageDto } from '@jotion/shared';
import Collaboration from '@tiptap/extension-collaboration';
import { Selection } from '@tiptap/pm/state';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@jotion/ui';
import { useTranslations } from 'next-intl';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { PageDto as CreatedPage } from '@jotion/shared';
import { apiPost, errorMessage } from '@/lib/api-client';
import { invalidateTree } from '@/lib/hooks';
import { pickPage } from '@/lib/quick-search-store';
import { EditorBubbleMenu } from './bubble-menu';
import { BlockHandle } from './block-handle';
import { openPageSession, type PageSession } from './collab-client';
import type { CommandContext } from './commands';
import { nodeViewOverrides } from './node-views';
import { useTrackSaveState } from './save-status';
import { createSlashCommand, type SlashLabels } from './slash-menu';

export interface PageEditorHandle {
  focusStart: () => void;
}

interface Props {
  page: PageDto;
  editable: boolean;
}

/** Bindet eine Seite an ihr Yjs-Dokument. Neue Sitzung je Seite (key = pageId). */
export const PageEditor = forwardRef<PageEditorHandle, Props>(function PageEditor(
  { page, editable },
  ref,
) {
  const [session, setSession] = useState<PageSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    const s = openPageSession(page.id);
    // Editor erst erzeugen, wenn der Inhalt da ist. Sonst schreibt der leere Startabsatz
    // (mit Block-ID) sich ins Dokument und jede Seite würde bei jedem Öffnen länger.
    void waitForInitialContent(s).then(() => {
      if (!cancelled) setSession(s);
    });
    return () => {
      cancelled = true;
      setSession(null);
      s.destroy();
    };
  }, [page.id]);

  if (!session) return <div className="min-h-[200px]" aria-busy="true" />;
  return <EditorInner ref={ref} page={page} editable={editable} session={session} />;
});

const EditorInner = forwardRef<PageEditorHandle, Props & { session: PageSession }>(
  function EditorInner({ page, editable, session }, ref) {
    const t = useTranslations('editor');
    const tdb = useTranslations('databaseCommands');
    const qc = useQueryClient();
    const [scope, setScope] = useState<'read-write' | 'readonly' | null>(null);
    const canWrite = editable && scope !== 'readonly';
    useTrackSaveState(session.provider, editable);

    useEffect(() => {
      const p: HocuspocusProvider = session.provider;
      const onAuth = ({ scope: s }: { scope: 'read-write' | 'readonly' }) => setScope(s);
      p.on('authenticated', onAuth);
      return () => void p.off('authenticated', onAuth);
    }, [session.provider]);

    // Labels und Kontext über Refs, damit die Editor-Instanz nicht bei jedem Render neu entsteht
    const labelsRef = useRef<SlashLabels>(null!);
    labelsRef.current = {
      // Datenbank-Befehle (Phase 4) haben eigene Übersetzungen im Namespace databaseCommands
      label: (id) => (id.startsWith('database') ? tdb(`${id}.label`) : t(`commands.${id}.label`)),
      description: (id) =>
        id.startsWith('database') ? tdb(`${id}.description`) : t(`commands.${id}.description`),
      empty: t('noCommands'),
      heading: t('blocks'),
    };
    const ctxRef = useRef<CommandContext>(null!);
    ctxRef.current = {
      createSubpage: async () => {
        try {
          const child = await apiPost<CreatedPage>(`/workspaces/${page.workspaceId}/pages`, {
            parentId: page.id,
            insertBlock: false,
          });
          invalidateTree(qc, page.workspaceId);
          return child.id;
        } catch (err) {
          toast.error(errorMessage(err));
          return null;
        }
      },
      pickPage,
      createDatabase: async ({ inline, sourceDatabaseId }) => {
        try {
          const db = await apiPost<{ id: string }>(`/workspaces/${page.workspaceId}/databases`, {
            parentId: page.id,
            inline,
            sourceDatabaseId,
            insertBlock: false,
          });
          invalidateTree(qc, page.workspaceId);
          return db.id;
        } catch (err) {
          toast.error(errorMessage(err));
          return null;
        }
      },
    };

    const extensions = useMemo(
      () =>
        jotionExtensions({
          collaborative: true,
          overrides: nodeViewOverrides,
          placeholder: (type, level) =>
            type === 'heading'
              ? t('placeholderHeading', { level: level ?? 1 })
              : type === 'paragraph'
                ? t('placeholder')
                : type === 'detailsSummary'
                  ? t('placeholderToggle')
                  : '',
          extra: [
            Collaboration.configure({ document: session.doc, field: 'default' }),
            createSlashCommand(
              () => labelsRef.current,
              () => ctxRef.current,
            ),
          ],
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [session.doc],
    );

    const editor = useEditor(
      {
        extensions,
        editable: canWrite,
        immediatelyRender: false,
        editorProps: {
          attributes: {
            class: 'jt-editor',
            'data-testid': 'editor',
            spellcheck: 'true',
            'aria-label': t('ariaLabel'),
          },
        },
      },
      [extensions],
    );

    useEffect(() => {
      if (editor && editor.isEditable !== canWrite) editor.setEditable(canWrite);
    }, [editor, canWrite]);

    useImperativeHandle(
      ref,
      () => ({
        focusStart: () => {
          if (!editor) return;
          // Tiptaps focus() wirkt erst im nächsten Frame; sofort fokussieren, damit
          // direkt folgende Tastendrücke nicht noch im Titel landen
          editor.commands.setTextSelection(Selection.atStart(editor.state.doc).from);
          editor.view.focus();
          editor.commands.focus('start');
        },
      }),
      [editor],
    );

    useScrollToHashBlock(editor, session);

    const blockUrl = (id: string) =>
      `${window.location.origin}/w/${page.workspaceId}/p/${page.id}#${id}`;

    return (
      <div className={cn('relative', !canWrite && 'jt-readonly')}>
        {editor && canWrite && <EditorBubbleMenu editor={editor} />}
        {editor && canWrite && (
          <BlockHandle editor={editor} ctx={ctxRef.current} blockUrl={blockUrl} />
        )}
        <EditorContent editor={editor} />
      </div>
    );
  },
);

/** Springt zu #<block-id> aus der URL, sobald der Inhalt geladen ist, und hebt den Block kurz hervor. */
function useScrollToHashBlock(editor: Editor | null, session: PageSession) {
  useEffect(() => {
    if (!editor) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    let done = false;
    const tryScroll = () => {
      if (done) return;
      const el = editor.view.dom.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (el) {
        done = true;
        el.scrollIntoView({ block: 'center' });
        el.classList.add('jt-flash');
        setTimeout(() => el.classList.remove('jt-flash'), 2000);
      }
    };
    tryScroll();
    session.provider.on('synced', tryScroll);
    void session.localReady.then(tryScroll);
    return () => void session.provider.off('synced', tryScroll);
  }, [editor, session]);
}

const OFFLINE_START_TIMEOUT_MS = 4000;

/**
 * Wartet auf den ersten Inhalt: Server synchronisiert, oder lokale Kopie mit Inhalt geladen
 * (sofort offline arbeitsfähig). Ohne beides (offline und noch nie geöffnet) nach kurzer Zeit.
 */
function waitForInitialContent(s: PageSession): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      s.provider.off('synced', finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, OFFLINE_START_TIMEOUT_MS);
    if (s.provider.synced) return finish();
    s.provider.on('synced', finish);
    void s.localReady.then(() => {
      if (s.doc.getXmlFragment(DOC_FRAGMENT).length > 0) finish();
    });
  });
}
