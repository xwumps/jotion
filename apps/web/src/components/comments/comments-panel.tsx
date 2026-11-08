'use client';

import type {
  CommentDto,
  CommentThreadDto,
  MemberDto,
  PageCommentsDto,
  PageDto,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, errorMessage } from '@/lib/api-client';
import { relativeTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useMembers } from '../database/use-database';

interface Draft {
  blockId: string;
  quote: string;
}

interface CommentsUi {
  open: boolean;
  setOpen: (o: boolean) => void;
  draft: Draft | null;
  startComment: (blockId: string, quote: string) => void;
  clearDraft: () => void;
}

/** Ereignis (detail = Seiten-ID), das die Kommentarleiste öffnet */
export const OPEN_COMMENTS_EVENT = 'jotion:open-comments';

const Ctx = createContext<CommentsUi | null>(null);
export const useCommentsUi = () => useContext(Ctx);

/** Phase 10: Zustand der Kommentarleiste einer Seite (offen, Entwurf für einen Block). */
export function CommentsProvider({ pageId, children }: { pageId: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Link aus dem Posteingang (#comment-<thread>) öffnet die Leiste, auch auf der offenen Seite
  useEffect(() => {
    if (window.location.hash.startsWith('#comment-')) setOpen(true);
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<string>).detail === pageId) setOpen(true);
    };
    window.addEventListener(OPEN_COMMENTS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_COMMENTS_EVENT, onOpen);
  }, [pageId]);
  const value = useMemo<CommentsUi>(
    () => ({
      open,
      setOpen,
      draft,
      startComment: (blockId, quote) => {
        setDraft({ blockId, quote });
        setOpen(true);
      },
      clearDraft: () => setDraft(null),
    }),
    [open, draft],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePageComments = (pageId: string) =>
  useQuery({
    queryKey: qk.comments(pageId),
    queryFn: () => apiGet<PageCommentsDto>(`/pages/${pageId}/comments`),
  });

/** Knopf in der Kopfzeile: Kommentarleiste ein- und ausblenden, Zahl offener Threads. */
export function CommentsToggle({ page }: { page: PageDto }) {
  const t = useTranslations('comments');
  const ui = useCommentsUi();
  const comments = usePageComments(page.id);
  if (!ui) return null;
  const open = comments.data?.threads.filter((x) => !x.resolvedAt).length ?? 0;
  return (
    <button
      type="button"
      onClick={() => ui.setOpen(!ui.open)}
      aria-pressed={ui.open}
      aria-label={t('toggle')}
      title={t('toggle')}
      className={cn(
        'flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] text-fg-muted hover:bg-hover',
        ui.open && 'bg-active text-fg',
      )}
      data-testid="comments-toggle"
    >
      <MessageSquare className="size-4" />
      {open > 0 && <span data-testid="comments-count">{open}</span>}
    </button>
  );
}

/** Seitenleiste mit allen Threads der Seite, neuem Seitenkommentar und Entwurf für Blöcke. */
export function CommentsPanel({ page }: { page: PageDto }) {
  const t = useTranslations('comments');
  const ui = useCommentsUi();
  const qc = useQueryClient();
  const comments = usePageComments(page.id);
  const members = useMembers(page.workspaceId);
  const [showResolved, setShowResolved] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.comments(page.id) });
  const create = useMutation({
    mutationFn: (body: object) => apiPost<CommentDto>(`/pages/${page.id}/comments`, body),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const threads = comments.data?.threads ?? [];
  const visible = threads.filter((x) => showResolved || !x.resolvedAt);
  const resolvedCount = threads.filter((x) => x.resolvedAt).length;
  const canComment = comments.data?.canComment ?? false;

  // Offene Block-Threads im Editor hervorheben
  const highlight = threads
    .filter((x) => x.blockId && !x.resolvedAt)
    .map((x) => `.jt-editor [data-id="${CSS.escape(x.blockId!)}"]`)
    .join(',');

  // Sprung aus dem Posteingang
  const panelOpen = ui?.open ?? false;
  useEffect(() => {
    const m = window.location.hash.match(/^#comment-([0-9a-f-]{36})$/);
    if (!m || !comments.data || !panelOpen) return;
    const el = document.querySelector(`[data-thread-id="${m[1]}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.classList.add('jt-flash');
  }, [comments.data, panelOpen]);

  if (!ui?.open) return null;
  return (
    <aside
      className="sticky top-11 flex h-[calc(100dvh-44px)] w-[340px] shrink-0 flex-col border-l border-border bg-bg print:hidden"
      aria-label={t('title')}
      data-testid="comments-panel"
    >
      {highlight && <style>{`${highlight}{background:var(--cb-yellow);border-radius:3px}`}</style>}
      <div className="flex h-10 items-center gap-2 border-b border-border px-3">
        <span className="text-[14px] font-medium">{t('title')}</span>
        {resolvedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved(!showResolved)}
            className="ml-auto rounded px-1.5 py-0.5 text-[12px] text-fg-muted hover:bg-hover"
            data-testid="comments-show-resolved"
          >
            {showResolved ? t('hideResolved') : t('showResolved', { count: resolvedCount })}
          </button>
        )}
        <button
          type="button"
          onClick={() => ui.setOpen(false)}
          aria-label={t('close')}
          className={cn('rounded p-1 text-fg-muted hover:bg-hover', !resolvedCount && 'ml-auto')}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {ui.draft && canComment && (
          <div className="mb-3 rounded-lg border border-accent/50 p-2" data-testid="comment-draft">
            {ui.draft.quote && <Quote text={ui.draft.quote} />}
            <Composer
              members={members.data ?? []}
              autoFocus
              placeholder={t('placeholder')}
              onCancel={ui.clearDraft}
              onSubmit={(body, mentions) =>
                create.mutate(
                  {
                    body,
                    mentions,
                    blockId: ui.draft!.blockId,
                    quote: ui.draft!.quote || undefined,
                  },
                  { onSuccess: ui.clearDraft },
                )
              }
            />
          </div>
        )}
        {visible.length === 0 && !ui.draft && (
          <p className="py-4 text-center text-[13px] text-fg-muted">{t('empty')}</p>
        )}
        <div className="flex flex-col gap-3">
          {visible.map((thread) => (
            <Thread
              key={thread.id}
              thread={thread}
              page={page}
              canComment={canComment}
              members={members.data ?? []}
              onChanged={refresh}
            />
          ))}
        </div>
      </div>
      {canComment && (
        <div className="border-t border-border p-3" data-testid="comment-page-composer">
          <Composer
            members={members.data ?? []}
            placeholder={t('pagePlaceholder')}
            onSubmit={(body, mentions) => create.mutate({ body, mentions })}
          />
        </div>
      )}
    </aside>
  );
}

function Quote({ text }: { text: string }) {
  return (
    <div className="mb-1.5 line-clamp-3 border-l-2 border-[var(--c-yellow)] pl-2 text-[12px] text-fg-muted">
      {text}
    </div>
  );
}

function Thread({
  thread,
  page,
  canComment,
  members,
  onChanged,
}: {
  thread: CommentThreadDto;
  page: PageDto;
  canComment: boolean;
  members: MemberDto[];
  onChanged: () => void;
}) {
  const t = useTranslations('comments');
  const [replying, setReplying] = useState(false);
  const reply = useMutation({
    mutationFn: (body: object) => apiPost(`/pages/${page.id}/comments`, body),
    onSuccess: () => {
      setReplying(false);
      onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resolve = useMutation({
    mutationFn: (resolved: boolean) => apiPut(`/comments/${thread.id}/resolved`, { resolved }),
    onSuccess: onChanged,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const jump = () => {
    if (!thread.blockId) return;
    const el = document.querySelector(`.jt-editor [data-id="${CSS.escape(thread.blockId)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  return (
    <div
      className={cn('rounded-lg border border-border p-2', thread.resolvedAt && 'opacity-70')}
      data-testid="comment-thread"
      data-thread-id={thread.id}
      data-block-id={thread.blockId ?? ''}
      data-resolved={thread.resolvedAt ? 'true' : 'false'}
    >
      <div className="mb-1 flex items-center gap-1">
        {thread.blockId ? (
          <button
            type="button"
            onClick={jump}
            className="min-w-0 flex-1 text-left"
            title={t('jumpToBlock')}
          >
            {thread.quote ? (
              <Quote text={thread.quote} />
            ) : (
              <span className="text-[12px] text-fg-subtle">{t('onBlock')}</span>
            )}
          </button>
        ) : (
          <span className="flex-1 text-[12px] text-fg-subtle">{t('onPage')}</span>
        )}
        {canComment && (
          <button
            type="button"
            onClick={() => resolve.mutate(!thread.resolvedAt)}
            className="shrink-0 rounded p-1 text-fg-muted hover:bg-hover"
            aria-label={thread.resolvedAt ? t('reopen') : t('resolve')}
            title={thread.resolvedAt ? t('reopen') : t('resolve')}
            data-testid="comment-resolve"
          >
            {thread.resolvedAt ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {thread.comments.map((c) => (
          <CommentItem key={c.id} c={c} members={members} onChanged={onChanged} />
        ))}
      </ul>
      {canComment &&
        (replying ? (
          <div className="mt-2">
            <Composer
              members={members}
              autoFocus
              placeholder={t('replyPlaceholder')}
              onCancel={() => setReplying(false)}
              onSubmit={(body, mentions) => reply.mutate({ body, mentions, threadId: thread.id })}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="mt-1.5 rounded px-1.5 py-0.5 text-[12px] text-fg-muted hover:bg-hover"
            data-testid="comment-reply"
          >
            {t('reply')}
          </button>
        ))}
    </div>
  );
}

function CommentItem({
  c,
  members,
  onChanged,
}: {
  c: CommentDto;
  members: MemberDto[];
  onChanged: () => void;
}) {
  const t = useTranslations('comments');
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const update = useMutation({
    mutationFn: (body: object) => apiPatch(`/comments/${c.id}`, body),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/comments/${c.id}`),
    onSuccess: onChanged,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <li className="group" data-testid="comment">
      <div className="flex items-baseline gap-1.5 text-[12px]">
        <span className="font-medium text-fg">{c.author.name}</span>
        <span className="text-fg-subtle">{relativeTime(c.createdAt, locale)}</span>
        {c.editedAt && <span className="text-fg-subtle">{t('edited')}</span>}
        <span className="ml-auto flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          {c.canEdit && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded px-1 text-fg-muted hover:bg-hover"
            >
              {t('edit')}
            </button>
          )}
          {c.canDelete && (
            <button
              type="button"
              onClick={() => remove.mutate()}
              aria-label={t('delete')}
              className="rounded p-0.5 text-fg-muted hover:bg-hover"
              data-testid="comment-delete"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </span>
      </div>
      {editing ? (
        <Composer
          members={members}
          initial={c.body}
          initialMentions={c.mentions}
          autoFocus
          placeholder=""
          onCancel={() => setEditing(false)}
          onSubmit={(body, mentions) => update.mutate({ body, mentions })}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-[14px]" data-testid="comment-body">
          <Body text={c.body} mentions={c.mentions} />
        </p>
      )}
    </li>
  );
}

/** Text mit hervorgehobenen @Erwähnungen */
function Body({ text, mentions }: { text: string; mentions: { id: string; name: string }[] }) {
  const names = mentions.map((m) => m.name).filter(Boolean);
  if (!names.length) return <>{text}</>;
  const re = new RegExp(
    `(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`,
    'g',
  );
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rounded bg-accent/10 px-0.5 text-accent">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Eingabe mit @-Erwähnungen (Mitglieder des Workspace). */
function Composer({
  members,
  placeholder,
  onSubmit,
  onCancel,
  initial = '',
  initialMentions = [],
  autoFocus,
}: {
  members: MemberDto[];
  placeholder: string;
  onSubmit: (body: string, mentions: string[]) => void;
  onCancel?: () => void;
  initial?: string;
  initialMentions?: { id: string; name: string }[];
  autoFocus?: boolean;
}) {
  const t = useTranslations('comments');
  const [text, setText] = useState(initial);
  const [mentioned, setMentioned] = useState(
    () => new Map(initialMentions.map((m) => [m.id, m.name])),
  );
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [caret, setCaret] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (caret === null || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(caret, caret);
    setCaret(null);
  }, [caret]);

  const matches =
    query === null
      ? []
      : members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const onInput = (value: string, caret: number) => {
    setText(value);
    const m = value.slice(0, caret).match(/(?:^|\s)@([\p{L}\d._-]{0,30})$/u);
    setQuery(m ? m[1]! : null);
    setActive(0);
  };

  const pick = (m: MemberDto) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@([\p{L}\d._-]{0,30})$/u, `@${m.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setMentioned(new Map(mentioned).set(m.userId, m.name));
    setQuery(null);
    // Cursor nach dem Rendern direkt hinter die Erwähnung setzen
    setCaret(before.length);
  };

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    // Nur Erwähnungen, deren @Name noch im Text steht
    const ids = [...mentioned].filter(([, name]) => body.includes(`@${name}`)).map(([id]) => id);
    onSubmit(body, ids);
    setText('');
    setMentioned(new Map());
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={text}
        autoFocus={autoFocus}
        rows={2}
        placeholder={placeholder}
        onChange={(e) => onInput(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(
                (a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length,
              );
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              pick(matches[active]!);
              return;
            }
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (query !== null) setQuery(null);
            else onCancel?.();
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="w-full resize-none rounded-md border border-border bg-bg px-2 py-1.5 text-[14px] outline-none focus:border-accent"
        data-testid="comment-input"
      />
      {matches.length > 0 && (
        <ul
          className="absolute bottom-full left-0 z-20 mb-1 w-full rounded-md border border-border bg-bg-elevated p-1 shadow-popover"
          role="listbox"
          data-testid="comment-mention-menu"
        >
          {matches.map((m, i) => (
            <li key={m.userId}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                className={cn(
                  'w-full rounded px-2 py-1 text-left text-[13px] hover:bg-hover',
                  i === active && 'bg-hover',
                )}
              >
                {m.name} <span className="text-fg-subtle">{m.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 flex justify-end gap-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-7 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover"
          >
            {t('cancel')}
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="h-7 rounded-md bg-accent px-2.5 text-[13px] text-white disabled:opacity-50"
          data-testid="comment-submit"
        >
          {t('send')}
        </button>
      </div>
    </div>
  );
}
