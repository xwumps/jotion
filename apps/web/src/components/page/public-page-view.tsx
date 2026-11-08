'use client';

import { jotionExtensions } from '@jotion/editor';
import type { PublicPageDto } from '@jotion/shared';
import { EditorContent, useEditor } from '@tiptap/react';
import { ArrowLeft, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';

/**
 * Phase 10: Öffentliche Leseansicht. Ohne Node-Views der App (die angemeldete Abfragen brauchen),
 * daher erscheinen eingebettete Datenbanken und Diagramme nur als Platzhalter.
 */
export function PublicPageView({ token, data }: { token: string; data: PublicPageDto }) {
  const t = useTranslations('sharing');
  const extensions = useMemo(() => jotionExtensions(), []);
  const editor = useEditor(
    {
      extensions,
      editable: false,
      immediatelyRender: false,
      content: data.doc as object,
      editorProps: { attributes: { class: 'jt-editor', 'data-testid': 'public-content' } },
    },
    [data.page.id],
  );
  const href = (id: string | null) =>
    id && id !== data.rootId ? `/share/${token}?page=${id}` : `/share/${token}`;
  const icon = data.page.icon?.type === 'emoji' ? data.page.icon.value : null;

  return (
    <div className="min-h-dvh bg-bg" data-testid="public-page">
      <div className="flex h-11 items-center gap-2 border-b border-border px-4 text-[13px] text-fg-muted">
        {data.page.parentId && (
          <Link
            href={href(data.page.parentId)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-hover"
          >
            <ArrowLeft className="size-4" />
            {t('back')}
          </Link>
        )}
        <span className="ml-auto">{t('readOnly')}</span>
      </div>
      <article className="mx-auto w-full max-w-[800px] px-6 py-10">
        {icon && <div className="mb-2 text-[56px] leading-none">{icon}</div>}
        <h1 className="mb-4 text-[40px] font-bold leading-tight" data-testid="public-title">
          {data.page.title || t('untitled')}
        </h1>
        {data.page.kind === 'DATABASE' && (
          <p className="mb-4 text-[14px] text-fg-muted">{t('databaseNotShown')}</p>
        )}
        <EditorContent editor={editor} />
        {data.children.length > 0 && (
          <nav className="mt-8 border-t border-border pt-4" aria-label={t('subpages')}>
            <h2 className="mb-2 text-[13px] font-medium text-fg-subtle">{t('subpages')}</h2>
            <ul className="flex flex-col gap-1">
              {data.children.map((c) => (
                <li key={c.id}>
                  <Link
                    href={href(c.id)}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-[15px] hover:bg-hover"
                    data-testid="public-child"
                  >
                    {c.icon?.type === 'emoji' ? (
                      <span>{c.icon.value}</span>
                    ) : (
                      <FileText className="size-4 text-fg-muted" />
                    )}
                    <span className="underline decoration-border underline-offset-4">
                      {c.title || t('untitled')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </article>
    </div>
  );
}
