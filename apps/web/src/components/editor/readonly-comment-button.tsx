'use client';

import type { Editor } from '@tiptap/react';
import { MessageSquarePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

interface Target {
  blockId: string;
  quote: string;
  top: number;
  left: number;
}

/**
 * Phase 10: Kommentar-Knopf für schreibgeschützte Editoren. ProseMirror verfolgt dort die Auswahl
 * nicht (kein Fokus), daher wird die Auswahl des Browsers ausgewertet.
 */
export function ReadonlyCommentButton({
  editor,
  onComment,
}: {
  editor: Editor;
  onComment: (blockId: string, quote: string) => void;
}) {
  const t = useTranslations('editor');
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    const update = () => {
      const sel = window.getSelection();
      const root = editor.view.dom;
      if (!sel || sel.isCollapsed || !sel.rangeCount || !root.contains(sel.anchorNode)) {
        setTarget(null);
        return;
      }
      let pos: number;
      try {
        pos = editor.view.posAtDOM(sel.anchorNode!, sel.anchorOffset);
      } catch {
        setTarget(null);
        return;
      }
      const $pos = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
      let blockId: string | null = null;
      for (let d = $pos.depth; d > 0 && !blockId; d--)
        blockId = ($pos.node(d).attrs.id as string | undefined) ?? null;
      if (!blockId) {
        setTarget(null);
        return;
      }
      // Zitat aus dem Dokument (die Browser-Auswahl kann über das Blockende hinausreichen)
      let quote = sel.toString().trim();
      try {
        const head = editor.view.posAtDOM(sel.focusNode!, sel.focusOffset);
        const text = editor.state.doc
          .textBetween(Math.min(pos, head), Math.max(pos, head), ' ')
          .trim();
        if (text) quote = text;
      } catch {
        /* Auswahl außerhalb des Dokuments */
      }
      if (!quote) {
        setTarget(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setTarget({
        blockId,
        quote: quote.slice(0, 500),
        top: rect.top - 40,
        left: rect.left + rect.width / 2,
      });
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [editor]);

  if (!target) return null;
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onComment(target.blockId, target.quote);
        setTarget(null);
      }}
      className="fixed z-50 flex h-8 -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-bg-elevated px-2 text-[13px] text-fg-muted shadow-popover hover:bg-hover"
      style={{ top: Math.max(8, target.top), left: target.left }}
      aria-label={t('comment')}
      data-testid="readonly-comment"
    >
      <MessageSquarePlus className="size-4" />
      {t('comment')}
    </button>
  );
}
