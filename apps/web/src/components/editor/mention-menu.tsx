'use client';

import { Extension, type Editor, type Range } from '@tiptap/core';
import type { MentionAttrs } from '@jotion/editor';
import type { MentionCandidatesDto, PageIcon as PageIconValue } from '@jotion/shared';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { cn } from '@jotion/ui';
import { Calendar, User } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { PageIcon } from '../page/page-icon';

export interface MentionItem {
  key: string;
  group: 'people' | 'pages' | 'dates';
  label: string;
  hint?: string;
  icon?: PageIconValue | null;
  attrs: MentionAttrs;
}

export interface MentionLabels {
  people: string;
  pages: string;
  dates: string;
  empty: string;
  today: string;
  tomorrow: string;
  yesterday: string;
  untitled: string;
  formatDate: (iso: string) => string;
}

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Datum aus Eingabe: 2026-11-04, 4.11.2026, 04.11. (aktuelles Jahr) */
export function parseDateQuery(q: string, now = new Date()): string | null {
  const s = q.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/.exec(s);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : now.getFullYear()];
  }
  const date = new Date(y, mo - 1, d);
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return isoDay(date);
}

function dateItems(query: string, labels: MentionLabels): MentionItem[] {
  const now = new Date();
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return isoDay(d);
  };
  const named: [string, string][] = [
    [labels.today, day(0)],
    [labels.tomorrow, day(1)],
    [labels.yesterday, day(-1)],
  ];
  const q = query.trim().toLowerCase();
  const out: MentionItem[] = [];
  const parsed = parseDateQuery(query);
  if (parsed)
    out.push({
      key: `date-${parsed}`,
      group: 'dates',
      label: labels.formatDate(parsed),
      attrs: { kind: 'date', date: parsed },
    });
  for (const [label, iso] of named) {
    if (q && !label.toLowerCase().startsWith(q)) continue;
    out.push({
      key: `date-${label}`,
      group: 'dates',
      label,
      hint: labels.formatDate(iso),
      attrs: { kind: 'date', date: iso },
    });
  }
  return out;
}

interface ListProps {
  items: MentionItem[];
  labels: MentionLabels;
  onSelect: (item: MentionItem) => void;
}
interface ListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

const MentionList = forwardRef<ListHandle, ListProps>(function MentionList(
  { items, labels, onSelect },
  ref,
) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setIndex(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!items.length) return false;
      if (e.key === 'ArrowDown') return (setIndex((i) => (i + 1) % items.length), true);
      if (e.key === 'ArrowUp')
        return (setIndex((i) => (i - 1 + items.length) % items.length), true);
      if (e.key === 'Enter' || e.key === 'Tab') {
        const item = items[index];
        if (item) onSelect(item);
        return true;
      }
      return false;
    },
  }));
  let lastGroup = '';
  return (
    <div
      ref={listRef}
      role="listbox"
      data-testid="mention-menu"
      className="max-h-[320px] w-[300px] overflow-y-auto rounded-lg bg-bg-elevated p-1 text-fg shadow-popover"
    >
      {items.length === 0 && (
        <div className="px-2 py-2 text-[14px] text-fg-subtle">{labels.empty}</div>
      )}
      {items.map((item, i) => {
        const header = item.group !== lastGroup;
        lastGroup = item.group;
        return (
          <div key={item.key}>
            {header && (
              <div className="px-2 pb-1 pt-2 text-[12px] font-medium text-fg-subtle">
                {labels[item.group]}
              </div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={i === index}
              data-index={i}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px]',
                i === index && 'bg-hover',
              )}
            >
              {item.group === 'people' ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-active text-[11px] font-medium">
                  {item.label.slice(0, 1).toUpperCase() || <User className="size-3" />}
                </span>
              ) : item.group === 'pages' ? (
                <PageIcon icon={item.icon ?? null} size={18} />
              ) : (
                <Calendar className="size-4 text-fg-muted" />
              )}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && (
                <span className="truncate text-[12px] text-fg-subtle">{item.hint}</span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
});

export const mentionPluginKey = new PluginKey('jotion-mention');

/** @-Menü: Personen, Seiten (nur sichtbare, vom Server gefiltert) und Datumsangaben. */
export function createMentionSuggestion(ws: () => string, getLabels: () => MentionLabels) {
  return Extension.create({
    name: 'mentionSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion<MentionItem, MentionItem>({
          editor: this.editor,
          pluginKey: mentionPluginKey,
          char: '@',
          allowSpaces: false,
          allow: ({ state, range }) =>
            state.doc.resolve(range.from).parent.type.name !== 'codeBlock',
          items: async ({ query }) => {
            const labels = getLabels();
            let data: MentionCandidatesDto = { users: [], pages: [] };
            try {
              data = await apiGet<MentionCandidatesDto>(
                `/workspaces/${ws()}/mention-candidates?q=${encodeURIComponent(query)}`,
              );
            } catch {
              /* offline: nur Datumsangaben */
            }
            return [
              ...data.users.map<MentionItem>((u) => ({
                key: `u-${u.id}`,
                group: 'people',
                label: u.name,
                attrs: { kind: 'user', targetId: u.id, label: u.name },
              })),
              ...dateItems(query, labels),
              ...data.pages.map<MentionItem>((p) => ({
                key: `p-${p.id}`,
                group: 'pages',
                label: p.title || labels.untitled,
                hint: p.path,
                icon: p.icon,
                attrs: { kind: 'page', targetId: p.id },
              })),
            ];
          },
          command: ({ editor, range, props }) => {
            (editor as Editor)
              .chain()
              .focus()
              .deleteRange(range as Range)
              .insertMention(props.attrs)
              .run();
          },
          render: () => {
            let renderer: ReactRenderer<ListHandle, ListProps> | null = null;
            let host: HTMLDivElement | null = null;
            const place = (props: SuggestionProps<MentionItem, MentionItem>) => {
              const rect = props.clientRect?.();
              if (!rect || !host) return;
              const below = window.innerHeight - rect.bottom > 340;
              host.style.left = `${Math.min(rect.left, window.innerWidth - 316)}px`;
              host.style.top = below ? `${rect.bottom + 6}px` : `${Math.max(8, rect.top - 326)}px`;
            };
            return {
              onStart: (props) => {
                host = document.createElement('div');
                host.style.position = 'fixed';
                host.style.zIndex = '60';
                document.body.appendChild(host);
                renderer = new ReactRenderer(MentionList, {
                  editor: props.editor,
                  props: {
                    items: props.items,
                    labels: getLabels(),
                    onSelect: (item: MentionItem) => props.command(item),
                  },
                });
                host.appendChild(renderer.element);
                place(props);
              },
              onUpdate: (props) => {
                if (!props.loading)
                  renderer?.updateProps({
                    items: props.items,
                    labels: getLabels(),
                    onSelect: (item: MentionItem) => props.command(item),
                  });
                place(props);
              },
              onKeyDown: ({ event }) => {
                if (event.key === 'Escape') return false;
                return renderer?.ref?.onKeyDown(event) ?? false;
              },
              onExit: () => {
                renderer?.destroy();
                host?.remove();
                renderer = null;
                host = null;
              },
            };
          },
        }),
      ];
    },
  });
}
