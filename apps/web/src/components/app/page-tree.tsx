'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { PageScope, PageTreeNodeDto } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { ChevronRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { pageHref } from '@/lib/format';
import { useChildren, usePageActions } from '@/lib/hooks';
import { useExpanded } from '@/lib/use-expanded';
import { PageIcon } from '../page/page-icon';
import { IconButton } from '../ui/icon-button';
import { PageItemMenu } from './page-item-menu';

type DropPosition = 'before' | 'after' | 'inside';
interface DropTarget {
  kind: 'row' | 'section';
  id: string;
  position?: DropPosition;
  scope?: PageScope;
}

interface TreeCtx {
  ws: string;
  activePageId: string | undefined;
  expanded: Set<string>;
  toggle: (id: string, open?: boolean) => void;
  dragId: string | null;
  target: DropTarget | null;
  register: (node: PageTreeNodeDto) => void;
}

const Ctx = createContext<TreeCtx | null>(null);
const useTree = () => useContext(Ctx)!;

/** DnD-Kontext für alle Baum-Abschnitte (Privat, Team), damit zwischen ihnen verschoben werden kann. */
export function PageTreeDnd({ ws, children }: { ws: string; children: ReactNode }) {
  const params = useParams<{ pageId?: string }>();
  const { expanded, toggle } = useExpanded(ws);
  const { move } = usePageActions(ws);
  const nodes = useRef(new Map<string, PageTreeNodeDto>());
  const [dragId, setDragId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const register = useCallback((node: PageTreeNodeDto) => {
    nodes.current.set(node.id, node);
  }, []);

  /** Liegt candidate im Teilbaum von ancestorId (soweit bekannt)? */
  const isWithin = (candidate: string, ancestorId: string) => {
    let cur: string | null | undefined = candidate;
    for (let i = 0; cur && i < 100; i++) {
      if (cur === ancestorId) return true;
      cur = nodes.current.get(cur)?.parentId;
    }
    return false;
  };

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));

  const onDragMove = (e: DragMoveEvent) => {
    const over = e.over;
    if (!over || !dragId) return setTarget(null);
    const data = over.data.current as { node?: PageTreeNodeDto; section?: PageScope } | undefined;
    if (data?.section)
      return setTarget({ kind: 'section', id: String(over.id), scope: data.section });
    const node = data?.node;
    if (!node || isWithin(node.id, dragId)) return setTarget(null);
    const pointerY = (e.activatorEvent as PointerEvent).clientY + e.delta.y;
    const ratio = (pointerY - over.rect.top) / over.rect.height;
    const position: DropPosition = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
    setTarget({ kind: 'row', id: node.id, position, scope: node.scope });
  };

  const reset = () => {
    setDragId(null);
    setTarget(null);
  };

  const onDragEnd = (_e: DragEndEvent) => {
    const id = dragId;
    const t = target;
    reset();
    if (!id || !t) return;
    if (t.kind === 'section') {
      move.mutate({ id, parentId: null, scope: t.scope });
      return;
    }
    const node = nodes.current.get(t.id);
    if (!node || node.id === id) return;
    if (t.position === 'inside') {
      move.mutate({ id, parentId: node.id });
      toggle(node.id, true);
    } else {
      move.mutate({
        id,
        parentId: node.parentId,
        scope: node.scope,
        ...(t.position === 'before' ? { beforeId: node.id } : { afterId: node.id }),
      });
    }
  };

  const ctx = useMemo<TreeCtx>(
    () => ({ ws, activePageId: params.pageId, expanded, toggle, dragId, target, register }),
    [ws, params.pageId, expanded, toggle, dragId, target, register],
  );
  const dragged = dragId ? nodes.current.get(dragId) : undefined;

  return (
    <Ctx.Provider value={ctx}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={reset}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {dragged && (
            <div className="flex h-[30px] w-56 items-center gap-2 rounded-md bg-bg-elevated px-2 text-[14px] opacity-90 shadow-popover">
              <PageIcon icon={dragged.icon} />
              <span className="truncate">{dragged.title || '…'}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </Ctx.Provider>
  );
}

/** Abschnitt (Privat/Team) mit eigener Drop-Fläche für "ans Ende dieses Bereichs". */
export function TreeSection({
  scope,
  title,
  nodes,
  onAdd,
}: {
  scope: PageScope;
  title: string;
  nodes: PageTreeNodeDto[];
  onAdd: () => void;
}) {
  const t = useTranslations('sidebar');
  const { target } = useTree();
  const { setNodeRef } = useDroppable({ id: `section:${scope}`, data: { section: scope } });
  const isTarget = target?.kind === 'section' && target.scope === scope;

  return (
    <div className="mt-4" data-testid={`section-${scope}`}>
      <div className="group flex h-[26px] items-center px-2">
        <span className="text-[12px] font-medium text-fg-subtle">{title}</span>
        <IconButton
          onClick={onAdd}
          className="ml-auto size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={t('addPageIn', { section: title })}
        >
          <Plus />
        </IconButton>
      </div>
      <div role="tree" aria-label={title}>
        {nodes.map((n) => (
          <TreeItem key={n.id} node={n} depth={0} />
        ))}
      </div>
      <div ref={setNodeRef} className={cn('mx-1 h-3 rounded', isTarget && 'bg-accent/15')}>
        {nodes.length === 0 && !isTarget && <span className="sr-only">{t('emptyTree')}</span>}
      </div>
      {nodes.length === 0 && (
        <button
          type="button"
          onClick={onAdd}
          className="-mt-3 flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[14px] text-fg-subtle hover:bg-hover"
        >
          <Plus className="size-4" />
          {t('addPage')}
        </button>
      )}
    </div>
  );
}

function TreeItem({ node, depth }: { node: PageTreeNodeDto; depth: number }) {
  const t = useTranslations('sidebar');
  const tc = useTranslations('common');
  const { ws, activePageId, expanded, toggle, dragId, target, register } = useTree();
  const { create } = usePageActions(ws);
  const open = expanded.has(node.id);
  const children = useChildren(node.id, open);
  const drag = useDraggable({ id: node.id, data: { node } });
  const drop = useDroppable({ id: `row:${node.id}`, data: { node } });

  useEffect(() => register(node), [node, register]);

  const isTarget = target?.kind === 'row' && target.id === node.id;
  const active = activePageId === node.id;
  const indent = 8 + depth * 14;

  return (
    <div
      role="treeitem"
      aria-expanded={open}
      aria-selected={active}
      aria-label={node.title || tc('untitled')}
    >
      <div
        ref={(el) => {
          drag.setNodeRef(el);
          drop.setNodeRef(el);
        }}
        {...drag.listeners}
        {...drag.attributes}
        role="presentation"
        className={cn(
          'group relative flex h-[30px] items-center gap-1 rounded-md pr-1 text-[14px] text-fg-muted transition-colors',
          active ? 'bg-active font-medium text-fg' : 'hover:bg-hover',
          dragId === node.id && 'opacity-40',
          isTarget && target.position === 'inside' && 'bg-accent/15',
        )}
        style={{ paddingLeft: indent }}
        data-testid="tree-item"
        data-title={node.title}
      >
        {isTarget && target.position !== 'inside' && (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute left-1 right-1 h-[3px] rounded-full bg-accent/70',
              target.position === 'before' ? '-top-[1.5px]' : '-bottom-[1.5px]',
            )}
          />
        )}
        <button
          type="button"
          onClick={() => toggle(node.id)}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={open ? t('collapse') : t('expand')}
          className="relative flex size-[22px] shrink-0 items-center justify-center rounded-[5px] hover:bg-active"
        >
          <span className="group-hover:invisible">
            <PageIcon icon={node.icon} />
          </span>
          <ChevronRight
            className={cn(
              'invisible absolute size-4 text-fg-muted transition-transform group-hover:visible',
              open && 'rotate-90',
            )}
          />
        </button>
        <Link
          href={pageHref(ws, node.id)}
          className="min-w-0 flex-1 truncate py-1"
          draggable={false}
        >
          {node.title || <span className="text-fg-subtle">{tc('untitled')}</span>}
        </Link>
        <div
          className="flex items-center opacity-0 group-hover:opacity-100 has-[[data-state=open]]:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <PageItemMenu ws={ws} node={node} />
          <IconButton
            aria-label={t('addSubpage')}
            onClick={() => {
              toggle(node.id, true);
              create.mutate({ parentId: node.id });
            }}
          >
            <Plus />
          </IconButton>
        </div>
      </div>
      {open && (
        <div role="group">
          {children.data?.map((c) => (
            <TreeItem key={c.id} node={c} depth={depth + 1} />
          ))}
          {children.data?.length === 0 && (
            <div
              className="flex h-[30px] items-center text-[13px] text-fg-subtle"
              style={{ paddingLeft: indent + 26 }}
            >
              {t('noSubpages')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
