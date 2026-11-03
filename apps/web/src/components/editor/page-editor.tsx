'use client';

import type { HocuspocusProvider } from '@hocuspocus/provider';
import { DOC_FRAGMENT, jotionExtensions } from '@jotion/editor';
import type { PageDto } from '@jotion/shared';
import Collaboration from '@tiptap/extension-collaboration';
import { Selection } from '@tiptap/pm/state';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@jotion/ui';
import { useLocale, useTranslations } from 'next-intl';
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
import { PasteHandler } from '@jotion/editor/paste';
import { BlockSelectionLayer } from './block-selection-layer';
import { formatMentionDate } from './content-views';
import { EditorPageContext } from './editor-context';
import { createMediaPaste } from './media-paste';
import { createMentionSuggestion, type MentionLabels } from './mention-menu';
import { TableMenu } from './table-menu';

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
    const tm = useTranslations('contentBlocks.mention');
    const locale = useLocale();
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
    const mentionLabelsRef = useRef<MentionLabels>(null!);
    mentionLabelsRef.current = {
      people: tm('people'),
      pages: tm('pages'),
      dates: tm('dates'),
      empty: tm('empty'),
      today: tm('today'),
      tomorrow: tm('tomorrow'),
      yesterday: tm('yesterday'),
      untitled: t('untitled'),
      formatDate: (iso) => formatMentionDate(iso, locale),
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
            PasteHandler,
            createMediaPaste(() => page.workspaceId),
            createMentionSuggestion(
              () => page.workspaceId,
              () => mentionLabelsRef.current,
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

    const pageCtx = useMemo(
      () => ({ workspaceId: page.workspaceId, pageId: page.id }),
      [page.workspaceId, page.id],
    );
    const blockUrl = (id: string) =>
      `${window.location.origin}/w/${page.workspaceId}/p/${page.id}#${id}`;

    return (
      <EditorPageContext.Provider value={pageCtx}>
        <div className={cn('relative', !canWrite && 'jt-readonly')}>
          {editor && canWrite && <EditorBubbleMenu editor={editor} />}
          {editor && canWrite && (
            <BlockHandle editor={editor} ctx={ctxRef.current} blockUrl={blockUrl} />
          )}
          {editor && canWrite && <TableMenu editor={editor} />}
          {editor && canWrite && <BlockSelectionLayer editor={editor} />}
          <EditorContent editor={editor} />
        </div>
      </EditorPageContext.Provider>
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
