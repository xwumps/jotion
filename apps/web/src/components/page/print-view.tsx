'use client';

import { jotionExtensions } from '@jotion/editor';
import type { PageContentDto, PageDto } from '@jotion/shared';
import { useQuery } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import { cn } from '@jotion/ui';
import { ArrowLeft, Printer } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { coverStyle } from '@/lib/covers';
import { pageHref } from '@/lib/format';
import { EditorPageContext } from '../editor/editor-context';
import { nodeViewOverrides } from '../editor/node-views';
import { PageIcon } from './page-icon';

interface PrintOptions {
  expandToggles: boolean;
  backgrounds: boolean;
  header: boolean;
}
const DEFAULTS: PrintOptions = { expandToggles: true, backgrounds: true, header: true };
const STORAGE_KEY = 'jotion:print-options';

function loadOptions(): PrintOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PrintOptions>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

type Json = { type?: string; attrs?: Record<string, unknown>; content?: Json[] };

/** Toggles für den Druck aufklappen. */
function prepare(node: Json, expand: boolean): Json {
  const attrs =
    node.type === 'details' && expand ? { ...(node.attrs ?? {}), open: true } : node.attrs;
  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(node.content ? { content: node.content.map((c) => prepare(c, expand)) } : {}),
  };
}

/** Wartet, bis alle Bilder geladen sind (höchstens 5 s), damit sie mitgedruckt werden. */
async function imagesReady(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  for (const img of imgs) img.loading = 'eager';
  await Promise.race([
    Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((r) => {
              img.addEventListener('load', () => r(), { once: true });
              img.addEventListener('error', () => r(), { once: true });
            }),
      ),
    ),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
}

export function PrintView({ pageId }: { pageId: string }) {
  const t = useTranslations('contentPrint');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [options, setOptions] = useState<PrintOptions>(DEFAULTS);
  useEffect(() => setOptions(loadOptions()), []);
  const setOption = (patch: Partial<PrintOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* privater Modus */
    }
  };

  const page = useQuery({
    queryKey: ['printPage', pageId],
    queryFn: () => apiGet<PageDto>(`/pages/${pageId}`),
    retry: false,
  });
  const content = useQuery({
    queryKey: ['printContent', pageId],
    queryFn: () => apiGet<PageContentDto>(`/pages/${pageId}/content`),
    retry: false,
  });

  const doc = useMemo(
    () => (content.data ? prepare(content.data.doc as Json, options.expandToggles) : null),
    [content.data, options.expandToggles],
  );
  const extensions = useMemo(() => jotionExtensions({ overrides: nodeViewOverrides }), []);
  const editor = useEditor(
    {
      extensions,
      editable: false,
      immediatelyRender: false,
      content: doc ?? undefined,
      editorProps: { attributes: { class: 'jt-editor', 'data-testid': 'print-content' } },
    },
    [doc],
  );

  useEffect(() => {
    if (page.data) document.title = `${page.data.title || tc('untitled')} | Jotion`;
  }, [page.data, tc]);

  const back = () =>
    page.data ? router.push(pageHref(page.data.workspaceId, page.data.id)) : router.back();

  const print = async () => {
    const root = document.querySelector<HTMLElement>('[data-print-root]');
    if (root) await imagesReady(root);
    const after = () => {
      window.removeEventListener('afterprint', after);
      back();
    };
    window.addEventListener('afterprint', after);
    window.print();
  };

  if (page.isError || content.isError)
    return (
      <div className="flex h-dvh items-center justify-center text-[14px] text-fg-muted">
        {t('notFound')}
      </div>
    );
  const p = page.data;
  const ready = Boolean(p && editor && doc);

  return (
    <EditorPageContext.Provider value={{ workspaceId: p?.workspaceId ?? '', pageId }}>
      <div className="min-h-dvh bg-bg">
        <div
          className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-bg-elevated px-4 py-2 text-[14px] print:hidden"
          data-testid="print-options"
        >
          <button
            type="button"
            onClick={back}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-fg-muted hover:bg-hover"
          >
            <ArrowLeft className="size-4" />
            {t('back')}
          </button>
          <span className="font-medium">{t('title')}</span>
          {(
            [
              ['expandToggles', t('expandToggles')],
              ['backgrounds', t('backgrounds')],
              ['header', t('header')],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-1.5 text-fg-muted">
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => setOption({ [key]: e.target.checked })}
                className="size-4 accent-[var(--accent)]"
              />
              {label}
            </label>
          ))}
          <button
            type="button"
            disabled={!ready}
            onClick={() => void print()}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            data-testid="print-button"
          >
            <Printer className="size-4" />
            {t('print')}
          </button>
        </div>

        <article
          data-print-root
          className={cn(
            'jt-print mx-auto w-full max-w-[800px] px-6 py-10 print:max-w-none print:p-0',
            !options.backgrounds && 'jt-print-no-bg',
            p?.settings.font === 'serif' && 'font-serif',
            p?.settings.font === 'mono' && 'font-mono',
            p?.settings.smallText ? 'text-[14px]' : 'text-[16px]',
          )}
          aria-busy={!ready}
        >
          {options.header && p && (
            <div className="jt-print-header mb-4 hidden justify-between text-[11px] text-fg-subtle print:flex">
              <span>{p.title || tc('untitled')}</span>
              <span>
                {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date())}
              </span>
            </div>
          )}
          {p?.cover && (
            <div
              className="jt-print-cover mb-6 h-[160px] w-full rounded-md"
              style={coverStyle(p.cover)}
            />
          )}
          {p?.icon && (
            <div className="mb-2">
              <PageIcon icon={p.icon} size={56} />
            </div>
          )}
          {p && (
            <h1 className="mb-4 text-[2.2em] font-bold leading-tight" data-testid="print-title">
              {p.title || tc('untitled')}
            </h1>
          )}
          <EditorContent editor={editor} />
        </article>
      </div>
    </EditorPageContext.Provider>
  );
}
