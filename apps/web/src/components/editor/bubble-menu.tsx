'use client';

import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { TextSelection } from '@tiptap/pm/state';
import { CONTENT_COLOR_NAMES } from '@jotion/editor';
import { cn } from '@jotion/ui';
import {
  Bold,
  ChevronDown,
  Code,
  Italic,
  Link2,
  MessageSquarePlus,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

function Btn({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex h-8 min-w-8 items-center justify-center gap-0.5 px-1.5 text-fg-muted hover:bg-hover [&_svg]:size-4',
        active && 'text-accent',
      )}
    >
      {children}
    </button>
  );
}

export function ColorGrid({
  onText,
  onBackground,
}: {
  onText: (c: string) => void;
  onBackground: (c: string) => void;
}) {
  const t = useTranslations('editor');
  return (
    <div className="w-[220px] p-1">
      <div className="px-2 pb-1 pt-1.5 text-[12px] font-medium text-fg-subtle">
        {t('textColor')}
      </div>
      {CONTENT_COLOR_NAMES.map((c) => (
        <button
          key={`t-${c}`}
          type="button"
          onClick={() => onText(c)}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[14px] hover:bg-hover"
        >
          <span
            className="flex size-5 items-center justify-center rounded border border-border font-medium"
            data-color={c}
          >
            A
          </span>
          {t(`colors.${c}`)}
        </button>
      ))}
      <div className="px-2 pb-1 pt-2 text-[12px] font-medium text-fg-subtle">
        {t('backgroundColor')}
      </div>
      {CONTENT_COLOR_NAMES.map((c) => (
        <button
          key={`b-${c}`}
          type="button"
          onClick={() => onBackground(c)}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[14px] hover:bg-hover"
        >
          <span className="size-5 rounded border border-border" data-bg={c} />
          {t(`colors.${c}`)}
        </button>
      ))}
    </div>
  );
}

/** Formatierungsleiste über markiertem Text. */
/** Phase 10: Block und markierter Text der aktuellen Auswahl (für Kommentare). */
export function selectionTarget(editor: Editor): { blockId: string; quote: string } | null {
  const { from, to, $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const id = $from.node(d).attrs.id as string | undefined;
    if (id)
      return { blockId: id, quote: editor.state.doc.textBetween(from, to, ' ').slice(0, 500) };
  }
  return null;
}

export function EditorBubbleMenu({
  editor,
  onComment,
  commentOnly = false,
}: {
  editor: Editor;
  /** Phase 10: Kommentar zur Auswahl beginnen */
  onComment?: (blockId: string, quote: string) => void;
  /** Schreibgeschützt mit Kommentarrecht: nur der Kommentar-Knopf */
  commentOnly?: boolean;
}) {
  const t = useTranslations('editor');
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');

  const applyLink = () => {
    const value = url.trim();
    if (!value) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else {
      const href =
        /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') ? value : `https://${value}`;
      // Nur sichere Protokolle zulassen
      if (/^(https?:|mailto:|tel:|\/)/i.test(href))
        editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    setLinkOpen(false);
  };

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state }) =>
        (e.isEditable || commentOnly) &&
        !state.selection.empty &&
        // Nicht bei ausgewählten Blöcken (Bild, Rechteckauswahl) oder Tabellenzellen
        state.selection instanceof TextSelection &&
        !e.isActive('codeBlock') &&
        !e.isActive('subpage') &&
        !e.isActive('pageLink')
      }
      className="flex overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-popover"
      // BubbleMenu überträgt data-Attribute nicht auf sein eigenes Element, daher per Ref
      ref={(el) => el?.setAttribute('data-testid', 'bubble-menu')}
    >
      {onComment && (
        <Btn
          label={t('comment')}
          onClick={() => {
            const target = selectionTarget(editor);
            if (target) onComment(target.blockId, target.quote);
          }}
        >
          <MessageSquarePlus />
        </Btn>
      )}
      {!commentOnly && (
        <>
          <Btn
            label={t('bold')}
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold />
          </Btn>
          <Btn
            label={t('italic')}
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic />
          </Btn>
          <Btn
            label={t('underline')}
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <Underline />
          </Btn>
          <Btn
            label={t('strike')}
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough />
          </Btn>
          <Btn
            label={t('code')}
            active={editor.isActive('code')}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code />
          </Btn>
          <Popover
            open={linkOpen}
            onOpenChange={(o) => {
              setLinkOpen(o);
              if (o) setUrl((editor.getAttributes('link').href as string | undefined) ?? '');
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t('link')}
                title={t('link')}
                onMouseDown={(e) => e.preventDefault()}
                className={cn(
                  'flex h-8 min-w-8 items-center justify-center border-l border-border px-1.5 text-fg-muted hover:bg-hover',
                  editor.isActive('link') && 'text-accent',
                )}
              >
                <Link2 className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
              <form
                method="post"
                onSubmit={(e) => {
                  e.preventDefault();
                  applyLink();
                }}
                className="flex gap-1"
              >
                <input
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t('linkPlaceholder')}
                  className="h-8 w-60 rounded-md border border-border bg-bg px-2 text-[14px] outline-none focus:border-accent"
                  data-testid="link-input"
                />
                <button
                  type="submit"
                  className="h-8 rounded-md bg-accent px-2 text-[13px] font-medium text-white"
                >
                  {t('apply')}
                </button>
              </form>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t('color')}
                title={t('color')}
                onMouseDown={(e) => e.preventDefault()}
                className="flex h-8 items-center gap-0.5 border-l border-border px-2 text-[14px] text-fg-muted hover:bg-hover"
              >
                <span className="font-medium underline decoration-2 underline-offset-2">A</span>
                <ChevronDown className="size-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="max-h-[360px] overflow-y-auto p-0">
              <ColorGrid
                onText={(c) =>
                  editor
                    .chain()
                    .focus()
                    .setTextColor(c as never)
                    .run()
                }
                onBackground={(c) =>
                  editor
                    .chain()
                    .focus()
                    .setBackgroundColor(c as never)
                    .run()
                }
              />
            </PopoverContent>
          </Popover>
        </>
      )}
    </BubbleMenu>
  );
}
