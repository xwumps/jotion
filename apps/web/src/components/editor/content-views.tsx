'use client';

import {
  Audio,
  Bookmark,
  Breadcrumb,
  collectHeadings,
  ColumnList,
  EMBED_SANDBOX,
  Embed,
  FileBlock,
  Image,
  isFileUrl,
  MathBlock,
  MathInline,
  MAX_LATEX_LENGTH,
  Mention,
  normalizeColumnWidths,
  Pdf,
  resizeColumns,
  resolveEmbed,
  safeExternalUrl,
  safeMediaSrc,
  TableOfContents,
  Video,
  type HeadingEntry,
  type MediaNodeType,
} from '@jotion/editor';
import type { LinkPreviewDto, MemberDto, PageSummaryDto } from '@jotion/shared';
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@jotion/ui';
import katex from 'katex';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bookmark as BookmarkIcon,
  Download,
  ExternalLink,
  File as FileIcon,
  FileText,
  Film,
  Globe,
  ImageIcon,
  Lock,
  Music,
  Sigma,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { toast } from 'sonner';
import { apiGet, errorMessage } from '@/lib/api-client';
import { pageHref } from '@/lib/format';
import { usePage } from '@/lib/hooks';
import { qk } from '@/lib/query-keys';
import { formatBytes, uploadFile } from '@/lib/upload';
import { PageIcon } from '../page/page-icon';
import { useEditorPage } from './editor-context';
import { isUploadActive } from './media-paste';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

// ------------------------------------------------------------------ Hilfen

const ACCEPT: Record<MediaNodeType, string> = {
  image: 'image/png,image/jpeg,image/gif,image/webp',
  video: 'video/mp4,video/webm,video/quicktime',
  audio: 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/flac,audio/webm',
  pdf: 'application/pdf',
  file: '',
};

const MEDIA_ICON = { image: ImageIcon, video: Film, audio: Music, pdf: FileText, file: FileIcon };

function useWorkspaceId(): string {
  return useEditorPage().workspaceId;
}

/** Eigene Dateien per Pfad, externe Quellen unverändert (bereits geprüft). */
const downloadUrl = (src: string) => (isFileUrl(src) ? `${src}?download=1` : src);

function Caption({
  value,
  editable,
  onChange,
  placeholder,
}: {
  value: string;
  editable: boolean;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (!editable) return value ? <figcaption className="jt-caption">{value}</figcaption> : null;
  return (
    <input
      className="jt-caption w-full bg-transparent outline-none placeholder:text-fg-subtle"
      value={draft}
      maxLength={500}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onChange(draft)}
      // Tasten gehören dem Eingabefeld, nicht dem Editor (sonst ersetzt Enter den Block)
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          if (draft !== value) onChange(draft);
          (e.target as HTMLInputElement).blur();
        }
      }}
      onPaste={(e) => e.stopPropagation()}
      data-testid="media-caption"
    />
  );
}

/** Ziehbare Breite in Prozent (zentriert: beide Seiten, sonst eine Seite). */
function useWidthDrag(
  initial: number | null,
  align: string,
  onCommit: (width: number) => void,
): {
  width: number;
  start: (side: 'left' | 'right') => (e: ReactPointerEvent) => void;
  ref: React.RefObject<HTMLDivElement | null>;
} {
  const [width, setWidth] = useState(initial ?? 100);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setWidth(initial ?? 100), [initial]);
  const start = (side: 'left' | 'right') => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = ref.current?.parentElement;
    if (!container) return;
    const total = container.getBoundingClientRect().width;
    const startX = e.clientX;
    const startW = width;
    let current = startW;
    const factor = align === 'center' ? 2 : 1;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) * (side === 'left' ? -1 : 1) * factor;
      current = Math.min(100, Math.max(10, startW + (dx / total) * 100));
      setWidth(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onCommit(Math.round(current));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { width, start, ref };
}

function Placeholder({
  icon: Icon,
  label,
  children,
  testId,
}: {
  icon: typeof FileIcon;
  label: string;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <Popover defaultOpen={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="jt-media-placeholder flex w-full items-center gap-2.5 rounded-md bg-hover px-3 py-3 text-left text-[14px] text-fg-muted hover:bg-active"
          data-testid={testId}
        >
          <Icon className="size-5" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] max-w-[calc(100vw-32px)] p-3">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function UrlForm({
  placeholder,
  submit,
  onSubmit,
  testId,
}: {
  placeholder: string;
  submit: string;
  onSubmit: (url: string) => void;
  testId?: string;
}) {
  const [url, setUrl] = useState('');
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) onSubmit(url.trim());
      }}
    >
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={placeholder}
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-[14px] outline-none focus:border-accent"
        data-testid={testId}
      />
      <button
        type="submit"
        className="h-8 rounded-md bg-accent px-3 text-[14px] font-medium text-white hover:bg-accent-hover"
      >
        {submit}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------ Medien

function MediaView({ node, updateAttributes, editor, selected, getPos }: NodeViewProps) {
  const t = useTranslations('contentBlocks');
  const locale = useLocale();
  const ws = useWorkspaceId();
  const type = node.type.name as MediaNodeType;
  const src = safeMediaSrc(node.attrs.src);
  const editable = editor.isEditable;
  const [uploading, setUploading] = useState(false);
  const pendingUpload = isUploadActive(node.attrs.uploadId);
  const align = (['left', 'center', 'right'] as const).includes(node.attrs.align)
    ? (node.attrs.align as 'left' | 'center' | 'right')
    : 'center';
  const caption = String(node.attrs.caption ?? '');
  const drag = useWidthDrag(node.attrs.width as number | null, align, (width) =>
    updateAttributes({ width }),
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const res = await uploadFile(ws, file);
      const attrs = { src: res.url, name: res.name ?? file.name, size: res.size, mime: res.mime };
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      const target = editor.schema.nodes[res.kind];
      // Anderer Typ als der Platzhalter (z. B. ZIP in einem Bildblock): Block passend umwandeln
      if (res.kind !== type && target && typeof pos === 'number') {
        if (res.kind === 'file') toast.message(t('storedAsFile'));
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, target, { ...node.attrs, ...attrs }),
        );
      } else updateAttributes(attrs);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  if (!src) {
    const Icon = MEDIA_ICON[type];
    if (uploading || pendingUpload)
      return (
        <NodeViewWrapper className="my-1" data-type={type} contentEditable={false}>
          <div className="flex items-center gap-2.5 rounded-md bg-hover px-3 py-3 text-[14px] text-fg-muted">
            <Icon className="size-5 animate-pulse" />
            {t('uploading')}
          </div>
        </NodeViewWrapper>
      );
    return (
      <NodeViewWrapper
        className="my-1"
        data-type={type}
        contentEditable={false}
        onDragOver={(e: React.DragEvent) => editable && e.preventDefault()}
        onDrop={(e: React.DragEvent) => {
          const f = e.dataTransfer.files[0];
          if (!editable || !f) return;
          e.preventDefault();
          e.stopPropagation();
          void upload(f);
        }}
      >
        {editable ? (
          <Placeholder icon={Icon} label={t(`add.${type}`)} testId="media-placeholder">
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT[type] || undefined}
              className="hidden"
              data-testid="media-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="mb-3 h-8 w-full rounded-md bg-accent text-[14px] font-medium text-white hover:bg-accent-hover"
            >
              {t('upload')}
            </button>
            <UrlForm
              placeholder={t('linkPlaceholder')}
              submit={t('embedLink')}
              testId="media-url-input"
              onSubmit={(url) => {
                const safe = safeExternalUrl(url);
                if (!safe) return void toast.error(t('invalidUrl'));
                updateAttributes({
                  src: safe,
                  name: new URL(safe).pathname.split('/').pop() || safe,
                });
              }}
            />
            <p className="mt-2 text-[12px] text-fg-subtle">{t('dropHint')}</p>
          </Placeholder>
        ) : (
          <div className="rounded-md bg-hover px-3 py-3 text-[14px] text-fg-subtle">
            {t(`empty.${type}`)}
          </div>
        )}
      </NodeViewWrapper>
    );
  }

  const name = String(node.attrs.name ?? '') || src.split('/').pop() || '';
  const size = formatBytes(node.attrs.size as number | null, locale);

  if (type === 'file' || (type === 'pdf' && !isFileUrl(src))) {
    return (
      <NodeViewWrapper className="my-1" data-type={type} contentEditable={false}>
        <a
          href={downloadUrl(src)}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-hover',
            selected && 'ProseMirror-selectednode',
          )}
          data-testid="file-block"
          draggable={false}
        >
          {type === 'pdf' ? <FileText className="size-4" /> : <FileIcon className="size-4" />}
          <span className="truncate">{name}</span>
          {size && <span className="text-[12px] text-fg-subtle">{size}</span>}
          <Download className="ml-auto size-4 text-fg-subtle" />
        </a>
        <Caption
          value={caption}
          editable={editable}
          onChange={(c) => updateAttributes({ caption: c })}
          placeholder={t('captionPlaceholder')}
        />
      </NodeViewWrapper>
    );
  }

  const box = (content: ReactNode, resizable: boolean) => (
    <NodeViewWrapper
      className={cn('jt-media group/media my-1 flex flex-col', `jt-align-${align}`)}
      data-type={type}
      contentEditable={false}
    >
      <div
        ref={drag.ref}
        className={cn('relative max-w-full', selected && 'jt-media-selected')}
        style={{ width: `${drag.width}%` }}
      >
        {content}
        {editable && resizable && (
          <>
            <span className="jt-resize jt-resize-left" onPointerDown={drag.start('left')} />
            <span className="jt-resize jt-resize-right" onPointerDown={drag.start('right')} />
          </>
        )}
        {editable && (
          <div className="absolute right-1.5 top-1.5 flex gap-0.5 rounded-md bg-bg-elevated/95 p-0.5 opacity-0 shadow-sm transition-opacity group-hover/media:opacity-100 print:hidden">
            {(
              [
                ['left', AlignLeft],
                ['center', AlignCenter],
                ['right', AlignRight],
              ] as const
            ).map(([a, Icon]) => (
              <button
                key={a}
                type="button"
                aria-label={t(`align.${a}`)}
                title={t(`align.${a}`)}
                aria-pressed={align === a}
                onClick={() => updateAttributes({ align: a })}
                className={cn(
                  'flex size-6 items-center justify-center rounded hover:bg-hover',
                  align === a && 'text-accent',
                )}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
            <a
              href={downloadUrl(src)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('open')}
              title={t('open')}
              className="flex size-6 items-center justify-center rounded hover:bg-hover"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        )}
      </div>
      <div style={{ width: `${drag.width}%` }} className="max-w-full">
        <Caption
          value={caption}
          editable={editable}
          onChange={(c) => updateAttributes({ caption: c })}
          placeholder={t('captionPlaceholder')}
        />
      </div>
    </NodeViewWrapper>
  );

  if (type === 'image')
    return box(
      <img
        src={src}
        alt={caption}
        loading="lazy"
        referrerPolicy="no-referrer"
        draggable={false}
        className="block w-full rounded-[3px]"
        data-testid="image-block"
      />,
      true,
    );
  if (type === 'video')
    return box(
      <video
        src={src}
        controls
        preload="metadata"
        className="block w-full rounded-[3px] bg-black"
        data-testid="video-block"
      />,
      true,
    );
  if (type === 'audio')
    return box(
      <div className="rounded-md bg-hover p-2">
        <div className="mb-1 truncate px-1 text-[13px] text-fg-muted">{name}</div>
        <audio src={src} controls preload="metadata" className="w-full" data-testid="audio-block" />
      </div>,
      false,
    );
  // PDF aus dem eigenen Speicher: Browser-Ansicht
  return box(
    <iframe
      src={`${src}?inline=1`}
      title={name}
      className="block h-[600px] w-full rounded-[3px] border border-border bg-white"
      data-testid="pdf-block"
    />,
    true,
  );
}

// ------------------------------------------------------------------ Bookmark

function BookmarkView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const t = useTranslations('contentBlocks');
  const ws = useWorkspaceId();
  const url = safeExternalUrl(node.attrs.url);
  const [loading, setLoading] = useState(false);

  const load = async (raw: string) => {
    setLoading(true);
    try {
      const p = await apiGet<LinkPreviewDto>(
        `/workspaces/${ws}/link-preview?url=${encodeURIComponent(raw)}`,
      );
      updateAttributes({
        url: p.url,
        title: p.title,
        description: p.description,
        image: p.image,
        siteName: p.siteName,
        favicon: p.favicon,
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (!url) {
    return (
      <NodeViewWrapper className="my-1" data-type="bookmark" contentEditable={false}>
        {editor.isEditable ? (
          loading ? (
            <div className="rounded-md bg-hover px-3 py-3 text-[14px] text-fg-muted">
              {t('loadingPreview')}
            </div>
          ) : (
            <Placeholder
              icon={BookmarkIcon}
              label={t('add.bookmark')}
              testId="bookmark-placeholder"
            >
              <UrlForm
                placeholder={t('linkPlaceholder')}
                submit={t('createBookmark')}
                testId="bookmark-url-input"
                onSubmit={(u) => void load(u)}
              />
            </Placeholder>
          )
        ) : null}
      </NodeViewWrapper>
    );
  }
  const image = safeExternalUrl(node.attrs.image);
  const favicon = safeExternalUrl(node.attrs.favicon);
  return (
    <NodeViewWrapper className="my-1" data-type="bookmark" contentEditable={false}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        draggable={false}
        className={cn(
          'jt-bookmark flex overflow-hidden rounded-md border border-border hover:bg-hover',
          selected && 'ProseMirror-selectednode',
        )}
        data-testid="bookmark"
      >
        <div className="min-w-0 flex-1 px-3.5 py-3">
          <div className="truncate text-[14px] text-fg">{node.attrs.title || url}</div>
          {node.attrs.description && (
            <div className="mt-1 line-clamp-2 text-[12px] text-fg-muted">
              {node.attrs.description}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5 text-[12px] text-fg">
            {favicon ? (
              <img
                src={favicon}
                alt=""
                width={16}
                height={16}
                referrerPolicy="no-referrer"
                className="size-4"
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            ) : (
              <Globe className="size-3.5 text-fg-subtle" />
            )}
            <span className="truncate">{url}</span>
          </div>
        </div>
        {image && (
          <img
            src={image}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="hidden w-[33%] max-w-[240px] shrink-0 object-cover sm:block"
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        )}
      </a>
    </NodeViewWrapper>
  );
}

// ------------------------------------------------------------------ Embed

function EmbedView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const t = useTranslations('contentBlocks');
  // iframe-Adresse wird immer aus der URL neu abgeleitet, nie aus gespeicherten Werten
  const resolved = useMemo(() => resolveEmbed(node.attrs.url), [node.attrs.url]);
  const url = safeExternalUrl(node.attrs.url);
  const [height, setHeight] = useState<number>(node.attrs.height ?? resolved?.height ?? 400);
  useEffect(
    () => setHeight(node.attrs.height ?? resolved?.height ?? 400),
    [node.attrs.height, resolved],
  );

  if (!url) {
    return (
      <NodeViewWrapper className="my-1" data-type="embed" contentEditable={false}>
        {editor.isEditable && (
          <Placeholder icon={Globe} label={t('add.embed')} testId="embed-placeholder">
            <UrlForm
              placeholder={t('embedPlaceholder')}
              submit={t('embedLink')}
              testId="embed-url-input"
              onSubmit={(u) => {
                if (!resolveEmbed(u)) return void toast.error(t('embedUnsupported'));
                updateAttributes({ url: u });
              }}
            />
            <p className="mt-2 text-[12px] text-fg-subtle">{t('embedProviders')}</p>
          </Placeholder>
        )}
      </NodeViewWrapper>
    );
  }
  if (!resolved) {
    return (
      <NodeViewWrapper className="my-1" data-type="embed" contentEditable={false}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="flex items-center gap-2 rounded-md bg-hover px-3 py-2.5 text-[14px] text-fg-muted"
        >
          <Globe className="size-4" />
          <span className="truncate">{url}</span>
          <span className="ml-auto shrink-0 text-[12px]">{t('embedUnsupported')}</span>
        </a>
      </NodeViewWrapper>
    );
  }
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    let current = startH;
    const move = (ev: PointerEvent) => {
      current = Math.min(1200, Math.max(120, startH + ev.clientY - startY));
      setHeight(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      updateAttributes({ height: Math.round(current) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <NodeViewWrapper className="my-1" data-type="embed" contentEditable={false}>
      <div
        className={cn('relative overflow-hidden rounded-md', selected && 'jt-media-selected')}
        data-testid="embed"
      >
        <iframe
          src={resolved.src}
          title={resolved.provider}
          sandbox={EMBED_SANDBOX}
          allow="fullscreen; picture-in-picture; encrypted-media; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          className="block w-full border-0 bg-hover"
          style={{ height }}
        />
        {editor.isEditable && (
          <span className="jt-resize-bottom print:hidden" onPointerDown={startResize} aria-hidden />
        )}
      </div>
      <Caption
        value={String(node.attrs.caption ?? '')}
        editable={editor.isEditable}
        onChange={(c) => updateAttributes({ caption: c })}
        placeholder={t('captionPlaceholder')}
      />
    </NodeViewWrapper>
  );
}

// ------------------------------------------------------------------ Inhaltsverzeichnis, Breadcrumb

function TocView({ editor, selected }: NodeViewProps) {
  const t = useTranslations('contentBlocks');
  const [headings, setHeadings] = useState<HeadingEntry[]>(() => collectHeadings(editor.state.doc));
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setHeadings(collectHeadings(editor.state.doc)));
    };
    editor.on('update', update);
    return () => {
      cancelAnimationFrame(frame);
      editor.off('update', update);
    };
  }, [editor]);
  const minLevel = Math.min(...headings.map((h) => h.level), 3);
  return (
    <NodeViewWrapper
      className={cn('jt-toc my-1 rounded-md py-1', selected && 'ProseMirror-selectednode')}
      data-type="tableOfContents"
      contentEditable={false}
    >
      <nav aria-label={t('toc')} data-testid="toc">
        {headings.length === 0 && (
          <p className="px-1 py-1 text-[14px] text-fg-subtle">{t('tocEmpty')}</p>
        )}
        {headings.map((h, i) => (
          <a
            key={`${h.id ?? i}-${h.pos}`}
            href={h.id ? `#${h.id}` : undefined}
            onClick={(e) => {
              e.preventDefault();
              const el = h.id
                ? editor.view.dom.querySelector(`[data-id="${CSS.escape(h.id)}"]`)
                : null;
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              if (h.id) history.replaceState(null, '', `#${h.id}`);
            }}
            className="block truncate rounded px-1 py-[3px] text-[14px] text-fg-muted underline decoration-border underline-offset-4 hover:bg-hover"
            style={{ paddingLeft: `${(h.level - minLevel) * 24 + 4}px` }}
          >
            {h.text || t('untitledHeading')}
          </a>
        ))}
      </nav>
    </NodeViewWrapper>
  );
}

function BreadcrumbView({ selected }: NodeViewProps) {
  const tc = useTranslations('common');
  const { workspaceId, pageId } = useEditorPage();
  const page = usePage(pageId);
  const crumbs = page.data
    ? [...page.data.breadcrumbs, { id: page.data.id, title: page.data.title, icon: page.data.icon }]
    : [];
  return (
    <NodeViewWrapper
      className={cn('my-1 rounded-md', selected && 'ProseMirror-selectednode')}
      data-type="breadcrumb"
      contentEditable={false}
    >
      <nav className="flex flex-wrap items-center text-[14px]" data-testid="breadcrumb-block">
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center">
            {i > 0 && <span className="px-1 text-fg-subtle">/</span>}
            <Link
              href={pageHref(workspaceId, c.id)}
              className="flex items-center gap-1.5 rounded px-1 py-0.5 text-fg-muted hover:bg-hover"
            >
              <PageIcon icon={c.icon} size={16} />
              <span className="max-w-[200px] truncate">{c.title || tc('untitled')}</span>
            </Link>
          </span>
        ))}
      </nav>
    </NodeViewWrapper>
  );
}

// ------------------------------------------------------------------ Formeln

function renderLatex(latex: string, displayMode: boolean): { html: string; error: boolean } {
  try {
    return {
      html: katex.renderToString(latex.slice(0, MAX_LATEX_LENGTH), {
        displayMode,
        throwOnError: true,
        trust: false,
        strict: 'ignore',
        maxSize: 50,
        maxExpand: 500,
        output: 'htmlAndMathml',
      }),
      error: false,
    };
  } catch {
    return { html: '', error: true };
  }
}

function MathEditor({
  latex,
  onSave,
  inline,
}: {
  latex: string;
  onSave: (v: string) => void;
  inline: boolean;
}) {
  const t = useTranslations('contentBlocks');
  const [draft, setDraft] = useState(latex);
  const preview = renderLatex(draft, !inline);
  return (
    <div className="flex flex-col gap-2">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || inline)) {
            e.preventDefault();
            onSave(draft);
          }
        }}
        rows={inline ? 1 : 3}
        placeholder="E = mc^2"
        className="w-full resize-y rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[13px] outline-none focus:border-accent"
        data-testid="math-input"
      />
      {draft && preview.error && (
        <p className="text-[12px] text-[var(--c-red)]">{t('mathError')}</p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSave(draft)}
          className="h-7 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover"
        >
          {t('done')}
        </button>
      </div>
    </div>
  );
}

function MathBlockView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const t = useTranslations('contentBlocks');
  const latex = String(node.attrs.latex ?? '');
  const [open, setOpen] = useState(!latex && editor.isEditable);
  const out = renderLatex(latex, true);
  const body = latex ? (
    out.error ? (
      <span className="font-mono text-[14px] text-[var(--c-red)]">{latex}</span>
    ) : (
      <span dangerouslySetInnerHTML={{ __html: out.html }} />
    )
  ) : (
    <span className="flex items-center gap-2 text-[14px] text-fg-subtle">
      <Sigma className="size-4" />
      {t('mathPlaceholder')}
    </span>
  );
  return (
    <NodeViewWrapper
      className={cn('jt-math-block my-1 rounded-md', selected && 'ProseMirror-selectednode')}
      data-type="mathBlock"
      contentEditable={false}
    >
      {editor.isEditable ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="block w-full overflow-x-auto rounded-md px-2 py-3 text-center hover:bg-hover"
              data-testid="math-block"
            >
              {body}
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-[460px] max-w-[calc(100vw-32px)] p-2">
            <MathEditor
              latex={latex}
              inline={false}
              onSave={(v) => {
                updateAttributes({ latex: v });
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <div className="overflow-x-auto px-2 py-3 text-center" data-testid="math-block">
          {body}
        </div>
      )}
    </NodeViewWrapper>
  );
}

function MathInlineView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const latex = String(node.attrs.latex ?? '');
  const [open, setOpen] = useState(false);
  const out = renderLatex(latex, false);
  const body =
    out.error || !latex ? (
      <span className="font-mono">{latex || '?'}</span>
    ) : (
      <span dangerouslySetInnerHTML={{ __html: out.html }} />
    );
  return (
    <NodeViewWrapper
      as="span"
      className={cn('jt-math-inline rounded px-0.5', selected && 'ProseMirror-selectednode')}
      data-type="mathInline"
      contentEditable={false}
    >
      {editor.isEditable ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <span
              role="button"
              tabIndex={-1}
              className="cursor-pointer hover:bg-hover"
              data-testid="math-inline"
            >
              {body}
            </span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[360px] max-w-[calc(100vw-32px)] p-2">
            <MathEditor
              latex={latex}
              inline
              onSave={(v) => {
                updateAttributes({ latex: v });
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <span data-testid="math-inline">{body}</span>
      )}
    </NodeViewWrapper>
  );
}

// ------------------------------------------------------------------ Erwähnungen

export function formatMentionDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    d,
  );
}

function MentionView({ node }: NodeViewProps) {
  const t = useTranslations('contentBlocks');
  const locale = useLocale();
  const ws = useWorkspaceId();
  const kind = node.attrs.kind as 'user' | 'page' | 'date';
  const targetId = node.attrs.targetId as string | null;
  const members = useQuery({
    queryKey: qk.members(ws),
    queryFn: () => apiGet<MemberDto[]>(`/workspaces/${ws}/members`),
    enabled: kind === 'user',
    staleTime: 5 * 60_000,
  });
  const summary = useQuery({
    queryKey: ['pageSummary', targetId],
    queryFn: () => apiGet<PageSummaryDto>(`/pages/${targetId}/summary`),
    enabled: kind === 'page' && Boolean(targetId),
    retry: false,
  });
  let content: ReactNode;
  if (kind === 'date') {
    content = (
      <span className="jt-mention jt-mention-date" data-testid="mention">
        @{node.attrs.date ? formatMentionDate(String(node.attrs.date), locale) : '?'}
      </span>
    );
  } else if (kind === 'user') {
    const m = members.data?.find((x) => x.userId === targetId);
    content = (
      <span className="jt-mention" data-testid="mention">
        @{m?.name ?? node.attrs.label ?? t('unknownPerson')}
      </span>
    );
  } else if (summary.isError || !targetId) {
    content = (
      <span className="jt-mention text-fg-subtle" data-testid="mention">
        <Lock className="mr-0.5 inline size-3" />
        {t('noAccess')}
      </span>
    );
  } else {
    const s = summary.data;
    content = (
      <Link
        href={pageHref(ws, targetId)}
        className="jt-mention-page"
        data-testid="mention"
        draggable={false}
      >
        <PageIcon icon={s?.icon ?? null} size={15} />
        <span
          className={cn(
            'underline decoration-border underline-offset-2',
            s?.deleted && 'line-through',
          )}
        >
          {s ? s.title || t('untitled') : '…'}
        </span>
      </Link>
    );
  }
  return (
    <NodeViewWrapper as="span" data-type="mention" data-kind={kind}>
      {content}
    </NodeViewWrapper>
  );
}

// ------------------------------------------------------------------ Spalten

function ColumnListView({ node, editor, getPos }: NodeViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [gutters, setGutters] = useState<number[]>([]);
  const widths = normalizeColumnWidths(
    Array.from({ length: node.childCount }, (_, i) => node.child(i).attrs.width as number | null),
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cols = Array.from(el.querySelectorAll<HTMLElement>('[data-type="column"]')).filter(
        (c) => c.closest('[data-type="columnList"]') === el,
      );
      const base = el.getBoundingClientRect().left;
      setGutters(cols.slice(0, -1).map((c) => c.getBoundingClientRect().right - base));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [node]);

  const startDrag = (index: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const total = el.getBoundingClientRect().width;
    const startX = e.clientX;
    const cols = Array.from(el.querySelectorAll<HTMLElement>('[data-type="column"]')).filter(
      (c) => c.closest('[data-type="columnList"]') === el,
    );
    let next = widths;
    const move = (ev: PointerEvent) => {
      next = resizeColumns(widths, index, (ev.clientX - startX) / total);
      cols.forEach((c, i) => (c.style.flexGrow = String(next[i])));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (typeof pos !== 'number') return;
      const { tr } = editor.state;
      let offset = pos + 1;
      node.forEach((child, _o, i) => {
        tr.setNodeMarkup(offset, undefined, {
          ...child.attrs,
          width: Math.round(next[i]! * 1000) / 1000,
        });
        offset += child.nodeSize;
      });
      editor.view.dispatch(tr);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <NodeViewWrapper ref={ref} className="jt-columns relative my-1" data-type="columnList">
      <NodeViewContent className="jt-columns-content" />
      {editor.isEditable &&
        gutters.map((x, i) => (
          <span
            key={i}
            className="jt-column-gutter print:hidden"
            style={{ left: x }}
            contentEditable={false}
            onPointerDown={startDrag(i)}
            data-testid="column-gutter"
            aria-hidden
          />
        ))}
    </NodeViewWrapper>
  );
}

// ------------------------------------------------------------------ Registrierung

const mediaView = () => ReactNodeViewRenderer(MediaView);

export const contentNodeViewOverrides = [
  Image.extend({ addNodeView: mediaView }),
  Video.extend({ addNodeView: mediaView }),
  Audio.extend({ addNodeView: mediaView }),
  FileBlock.extend({ addNodeView: mediaView }),
  Pdf.extend({ addNodeView: mediaView }),
  Bookmark.extend({ addNodeView: () => ReactNodeViewRenderer(BookmarkView) }),
  Embed.extend({ addNodeView: () => ReactNodeViewRenderer(EmbedView) }),
  TableOfContents.extend({ addNodeView: () => ReactNodeViewRenderer(TocView) }),
  Breadcrumb.extend({ addNodeView: () => ReactNodeViewRenderer(BreadcrumbView) }),
  MathBlock.extend({ addNodeView: () => ReactNodeViewRenderer(MathBlockView) }),
  MathInline.extend({
    addNodeView: () => ReactNodeViewRenderer(MathInlineView, { as: 'span' }),
  }),
  Mention.extend({ addNodeView: () => ReactNodeViewRenderer(MentionView, { as: 'span' }) }),
  ColumnList.extend({ addNodeView: () => ReactNodeViewRenderer(ColumnListView) }),
];
