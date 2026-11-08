'use client';

import type { PageSummaryDto } from '@jotion/shared';
import { Callout, PageLink, Subpage } from '@jotion/editor';
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@jotion/ui';
import { ArrowUpRight, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { apiGet } from '@/lib/api-client';
import { EMOJI_GROUPS } from '@/lib/emojis';
import { pageHref } from '@/lib/format';
import { PageIcon } from '../page/page-icon';
import { contentNodeViewOverrides } from './content-views';
import { useEditorPage } from './editor-context';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { ChartNode } from '../database/chart-node-view';
import { DatabaseNode } from '../database/database-node-view';

function PageRefView({ node, selected, kind }: NodeViewProps & { kind: 'subpage' | 'pageLink' }) {
  const t = useTranslations('editor');
  const { workspaceId } = useEditorPage();
  const pageId = node.attrs.pageId as string | null;
  const summary = useQuery({
    queryKey: ['pageSummary', pageId],
    queryFn: () => apiGet<PageSummaryDto>(`/pages/${pageId}/summary`),
    enabled: Boolean(pageId),
    retry: false,
  });
  const s = summary.data;
  const inaccessible = summary.isError;

  return (
    <NodeViewWrapper
      data-type={kind}
      className={cn('jt-page-ref my-px rounded-md', selected && 'ProseMirror-selectednode')}
      contentEditable={false}
      data-drag-handle
    >
      {inaccessible || !pageId ? (
        <span className="flex h-[30px] items-center gap-2 px-0.5 text-fg-subtle">
          <Lock className="size-4" />
          {t('noAccess')}
        </span>
      ) : (
        <Link
          href={pageHref(workspaceId, pageId)}
          className="flex h-[30px] items-center gap-2 rounded-md px-0.5 hover:bg-hover"
          data-testid="page-ref"
          draggable={false}
        >
          <span className="relative">
            <PageIcon icon={s?.icon ?? null} size={19} />
            {kind === 'pageLink' && (
              <ArrowUpRight className="absolute -bottom-1 -right-1 size-3 rounded-sm bg-bg text-fg-muted" />
            )}
          </span>
          <span
            className={cn(
              'truncate border-b border-border font-medium leading-tight',
              s?.deleted && 'line-through opacity-60',
            )}
          >
            {s ? s.title || t('untitled') : '…'}
          </span>
          {s?.deleted && <span className="text-[12px] text-fg-subtle">{t('inTrash')}</span>}
          {s?.archived && !s.deleted && (
            <span className="text-[12px] text-fg-subtle">{t('archived')}</span>
          )}
        </Link>
      )}
    </NodeViewWrapper>
  );
}

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const icon = (node.attrs.icon as string) || '💡';
  return (
    <NodeViewWrapper
      data-type="callout"
      className="jt-callout"
      data-block-color={node.attrs.blockColor ?? undefined}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            contentEditable={false}
            disabled={!editor.isEditable}
            className="jt-callout-icon"
            aria-label="Icon"
          >
            {icon}
          </button>
        </PopoverTrigger>
        <PopoverContent className="max-h-[280px] w-[320px] overflow-y-auto p-2">
          <div className="grid grid-cols-9">
            {EMOJI_GROUPS.flatMap((g) => g.emojis).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => updateAttributes({ icon: e })}
                className="flex size-8 items-center justify-center rounded-md text-[20px] hover:bg-hover"
              >
                {e}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <NodeViewContent className="jt-callout-content" />
    </NodeViewWrapper>
  );
}

/** Erweiterungen mit React-Ansichten (gleiche Namen wie im Schema, ersetzen die Basisversionen). */
export const nodeViewOverrides = [
  Subpage.extend({
    addNodeView: () =>
      ReactNodeViewRenderer((p: NodeViewProps) => <PageRefView {...p} kind="subpage" />),
  }),
  PageLink.extend({
    addNodeView: () =>
      ReactNodeViewRenderer((p: NodeViewProps) => <PageRefView {...p} kind="pageLink" />),
  }),
  Callout.extend({ addNodeView: () => ReactNodeViewRenderer(CalloutView) }),
  ...contentNodeViewOverrides,
  DatabaseNode,
  ChartNode,
];
