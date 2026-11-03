import { Extension } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Auswahl ganzer Blöcke der obersten Ebene (z. B. per Rechteckauswahl mit der Maus).
 * Kopieren, Ausschneiden und Löschen funktionieren wie bei jeder Auswahl über content()/replace().
 */
export class BlockRangeSelection extends Selection {
  constructor($from: ResolvedPos, $to: ResolvedPos) {
    super($from, $to);
  }

  override map(doc: PMNode, mapping: Mappable): Selection {
    const from = mapping.map(this.from, 1);
    const to = mapping.map(this.to, -1);
    if (from >= to) return Selection.near(doc.resolve(Math.min(from, doc.content.size)));
    return blockRangeBetween(doc, from, to) ?? Selection.near(doc.resolve(from));
  }

  override eq(other: Selection): boolean {
    return other instanceof BlockRangeSelection && other.from === this.from && other.to === this.to;
  }

  override toJSON(): { type: string; anchor: number; head: number } {
    return { type: 'jotionBlockRange', anchor: this.from, head: this.to };
  }

  static override fromJSON(doc: PMNode, json: { anchor: number; head: number }): Selection {
    return blockRangeBetween(doc, json.anchor, json.head) ?? Selection.atStart(doc);
  }

  /** Indizes der ausgewählten Blöcke (oberste Ebene) */
  blockIndices(): number[] {
    const out: number[] = [];
    const doc = this.$from.doc;
    let pos = 0;
    doc.forEach((node, offset, i) => {
      pos = offset;
      if (pos >= this.from && pos + node.nodeSize <= this.to) out.push(i);
    });
    return out;
  }
}

// Keine native Textmarkierung, die Blöcke werden per Dekoration hervorgehoben
BlockRangeSelection.prototype.visible = false;
try {
  Selection.jsonID('jotionBlockRange', BlockRangeSelection);
} catch {
  // bereits registriert (z. B. nach Hot Reload)
}

/**
 * Erzeugt eine Blockauswahl, die alle Blöcke der obersten Ebene zwischen from und to umfasst
 * (auf Blockgrenzen erweitert). null, wenn der Bereich leer ist.
 */
export function blockRangeBetween(
  doc: PMNode,
  from: number,
  to: number,
): BlockRangeSelection | null {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(doc.content.size, Math.max(from, to));
  let start = -1;
  let end = -1;
  doc.forEach((node, offset) => {
    const nodeEnd = offset + node.nodeSize;
    if (nodeEnd > lo && offset < hi) {
      if (start < 0) start = offset;
      end = nodeEnd;
    }
  });
  if (start < 0 || end <= start) return null;
  return new BlockRangeSelection(doc.resolve(start), doc.resolve(end));
}

/** Blockauswahl über Indizes der obersten Ebene (einschließlich). */
export function blockRangeByIndex(
  doc: PMNode,
  first: number,
  last: number,
): BlockRangeSelection | null {
  const lo = Math.max(0, Math.min(first, last));
  const hi = Math.min(doc.childCount - 1, Math.max(first, last));
  if (hi < lo) return null;
  let start = 0;
  for (let i = 0; i < lo; i++) start += doc.child(i).nodeSize;
  let end = start;
  for (let i = lo; i <= hi; i++) end += doc.child(i).nodeSize;
  return new BlockRangeSelection(doc.resolve(start), doc.resolve(end));
}

export const blockSelectionKey = new PluginKey('jotion-block-selection');

/** Hebt ausgewählte Blöcke hervor; Escape hebt die Auswahl auf. */
export const BlockSelection = Extension.create({
  name: 'blockSelection',
  addKeyboardShortcuts() {
    return {
      Escape: ({ editor }) => {
        const sel = editor.state.selection;
        if (!(sel instanceof BlockRangeSelection)) return false;
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(sel.from + 1))),
        );
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockSelectionKey,
        props: {
          decorations: (state) => {
            const sel = state.selection;
            if (!(sel instanceof BlockRangeSelection)) return null;
            const decos: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (offset >= sel.from && offset + node.nodeSize <= sel.to)
                decos.push(
                  Decoration.node(offset, offset + node.nodeSize, { class: 'jt-block-selected' }),
                );
            });
            return DecorationSet.create(state.doc, decos);
          },
          // Tippen ersetzt die ausgewählten Blöcke durch einen Absatz mit dem Zeichen
          handleTextInput: (view, _from, _to, text) => {
            const sel = view.state.selection;
            if (!(sel instanceof BlockRangeSelection)) return false;
            const para = view.state.schema.nodes.paragraph;
            if (!para) return false;
            const tr = view.state.tr.replaceWith(
              sel.from,
              sel.to,
              para.create(null, view.state.schema.text(text)),
            );
            tr.setSelection(TextSelection.create(tr.doc, sel.from + 1 + text.length));
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
