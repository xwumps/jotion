'use client';

import type {
  DatabaseDto,
  FileValue,
  MemberDto,
  PropertyDto,
  RowDto,
  ViewConfig,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import { coverStyle } from '@/lib/covers';
import { PageIcon } from '../../page/page-icon';
import { ValueDisplay } from '../cells';
import { orderedProperties } from '../table-view';

export type CardSize = 'small' | 'medium' | 'large';
export type CardPreview = 'none' | 'cover' | 'content' | 'files';

/** Properties, die Karten zeigen (ohne Titel), in Spaltenreihenfolge der Ansicht. */
export function cardProperties(db: DatabaseDto, cfg: ViewConfig): PropertyDto[] {
  const ids = new Set(cfg.cardProperties ?? []);
  return orderedProperties(db, cfg).filter((p) => p.type !== 'title' && ids.has(p.id));
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif)(\?|$)/i;

/** Bild für die Kartenvorschau (Cover, erstes Bild im Inhalt oder erste Bilddatei). */
export function previewStyle(
  row: RowDto,
  preview: CardPreview,
  db: DatabaseDto,
  previewPropertyId: string | null,
  fit: boolean,
): CSSProperties | 'text' | null {
  const img = (url: string): CSSProperties => ({
    backgroundImage: `url("${url.replace(/"/g, '%22')}")`,
    backgroundSize: fit ? 'contain' : 'cover',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
  });
  switch (preview) {
    case 'cover':
      return row.cover ? coverStyle(row.cover) : null;
    case 'content':
      if (row.preview?.image) return img(row.preview.image);
      return row.preview?.text ? 'text' : null;
    case 'files': {
      const prop =
        db.properties.find((p) => p.id === previewPropertyId) ??
        db.properties.find((p) => p.type === 'files');
      const files = (prop ? (row.values[prop.id] as FileValue[] | undefined) : undefined) ?? [];
      for (const f of files) {
        if (f.type === 'file' && IMAGE_RE.test(f.name)) return img(`/api/files/${f.fileId}`);
        if (f.type === 'external' && IMAGE_RE.test(f.url)) return img(f.url);
      }
      return null;
    }
    default:
      return null;
  }
}

export function Card({
  db,
  row,
  props,
  members,
  preview,
  previewPropertyId,
  fit,
  size,
  onOpen,
  dragging,
  children,
}: {
  db: DatabaseDto;
  row: RowDto;
  props: PropertyDto[];
  members: MemberDto[];
  preview: CardPreview;
  previewPropertyId: string | null;
  fit: boolean;
  size: CardSize;
  onOpen: () => void;
  dragging?: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations('database');
  const p = previewStyle(row, preview, db, previewPropertyId, fit);
  const imgH = size === 'small' ? 'h-[90px]' : size === 'large' ? 'h-[200px]' : 'h-[140px]';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group/card relative w-full cursor-pointer overflow-hidden rounded-md border border-border bg-bg-elevated text-left shadow-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent',
        dragging && 'opacity-40',
      )}
      data-testid="card"
      data-row={row.id}
    >
      {p === 'text' ? (
        <div
          className={cn(
            'overflow-hidden border-b border-border px-2.5 py-2 text-[12px] leading-snug text-fg-muted',
            imgH,
          )}
        >
          {row.preview?.text}
        </div>
      ) : p ? (
        <div className={cn('border-b border-border', imgH)} style={p} data-testid="card-preview" />
      ) : null}
      <div className={cn('flex flex-col gap-1', size === 'small' ? 'px-2 py-1.5' : 'px-2.5 py-2')}>
        <div className="flex min-w-0 items-center gap-1.5 text-[14px] font-medium">
          {row.icon ? (
            <PageIcon icon={row.icon} size={16} />
          ) : (
            preview === 'none' && <FileText className="size-4 shrink-0 text-fg-subtle" />
          )}
          <span className={cn('min-w-0 break-words', !row.title && 'text-fg-subtle')}>
            {row.title || t('untitled')}
          </span>
        </div>
        {props.map((prop) => (
          <CardValue key={prop.id} prop={prop} row={row} members={members} />
        ))}
      </div>
      {children}
    </div>
  );
}

function CardValue({
  prop,
  row,
  members,
}: {
  prop: PropertyDto;
  row: RowDto;
  members: MemberDto[];
}) {
  const v = row.values[prop.id];
  const empty =
    prop.type !== 'checkbox' &&
    !['created_time', 'created_by', 'last_edited_time', 'last_edited_by'].includes(prop.type) &&
    (v === undefined || v === null || (Array.isArray(v) && v.length === 0));
  if (empty) return null;
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] text-fg-muted [&_*]:text-[12px]"
      title={prop.name}
      data-testid="card-value"
    >
      <ValueDisplay prop={prop} row={row} members={members} />
    </div>
  );
}
