'use client';

import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion';
import { cn } from '@jotion/ui';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { filterCommands, type BlockCommand, type CommandContext } from './commands';

export interface SlashLabels {
  label: (id: string) => string;
  description: (id: string) => string;
  empty: string;
  heading: string;
}

interface ListProps {
  items: BlockCommand[];
  labels: SlashLabels;
  onSelect: (item: BlockCommand) => void;
}

interface ListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

const CommandList = forwardRef<ListHandle, ListProps>(function CommandList(
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

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={labels.heading}
      data-testid="slash-menu"
      className="max-h-[340px] w-[300px] overflow-y-auto rounded-lg bg-bg-elevated p-1 text-fg shadow-popover"
    >
      <div className="px-2 pb-1 pt-1.5 text-[12px] font-medium text-fg-subtle">
        {labels.heading}
      </div>
      {items.length === 0 && (
        <div className="px-2 py-2 text-[14px] text-fg-subtle">{labels.empty}</div>
      )}
      {items.map((item, i) => (
        <button
          key={item.id}
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
            'flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left',
            i === index && 'bg-hover',
          )}
        >
          <span className="flex size-[46px] shrink-0 items-center justify-center rounded-md border border-border bg-bg">
            <item.icon className="size-5 text-fg-muted" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px]">{labels.label(item.id)}</span>
            <span className="block truncate text-[12px] text-fg-subtle">
              {labels.description(item.id)}
            </span>
          </span>
          {item.shortcut && <span className="text-[12px] text-fg-subtle">{item.shortcut}</span>}
        </button>
      ))}
    </div>
  );
});

export const slashPluginKey = new PluginKey('jotion-slash');

/** Slash-Menü: "/" öffnet die Blockauswahl an der Cursorposition. */
export function createSlashCommand(getLabels: () => SlashLabels, getContext: () => CommandContext) {
  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [
        Suggestion<BlockCommand, BlockCommand>({
          editor: this.editor,
          pluginKey: slashPluginKey,
          char: '/',
          // Leerzeichen erlaubt ("/überschrift 1"); ohne Treffer schließt das Menü selbst
          allowSpaces: true,
          // Nicht in Codeblöcken
          allow: ({ state, range }) =>
            state.doc.resolve(range.from).parent.type.name !== 'codeBlock',
          items: ({ query }) => filterCommands(query, getLabels().label).slice(0, 20),
          command: ({ editor, range, props }) =>
            void props.run(editor as Editor, range as Range, getContext()),
          render: () => {
            let renderer: ReactRenderer<ListHandle, ListProps> | null = null;
            let host: HTMLDivElement | null = null;
            const place = (props: SuggestionProps<BlockCommand, BlockCommand>) => {
              const rect = props.clientRect?.();
              if (!rect || !host) return;
              const below = window.innerHeight - rect.bottom > 360;
              host.style.left = `${Math.min(rect.left, window.innerWidth - 316)}px`;
              host.style.top = below ? `${rect.bottom + 6}px` : `${Math.max(8, rect.top - 346)}px`;
            };
            return {
              onStart: (props) => {
                host = document.createElement('div');
                host.style.position = 'fixed';
                host.style.zIndex = '60';
                document.body.appendChild(host);
                renderer = new ReactRenderer(CommandList, {
                  editor: props.editor,
                  props: {
                    items: props.items,
                    labels: getLabels(),
                    onSelect: (item: BlockCommand) => props.command(item),
                  },
                });
                host.appendChild(renderer.element);
                place(props);
              },
              onUpdate: (props) => {
                // Während die Treffer berechnet werden, meldet Tiptap kurz items: [] mit loading: true.
                // Dann nichts ändern, sonst flackert die Liste oder das Menü schließt fälschlich.
                if (props.loading) {
                  place(props);
                  return;
                }
                // Wie bei Notion: nach einem Leerzeichen ohne Treffer ist es normaler Text
                if (
                  (props.items.length === 0 && props.query.endsWith(' ')) ||
                  props.query.length > 40
                ) {
                  exitSuggestion(props.editor.view, slashPluginKey);
                  return;
                }
                renderer?.updateProps({
                  items: props.items,
                  labels: getLabels(),
                  onSelect: (item: BlockCommand) => props.command(item),
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
