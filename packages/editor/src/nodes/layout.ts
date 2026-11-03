import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 5;
/** Kleinste Spaltenbreite als Anteil (beim Ziehen) */
export const MIN_COLUMN_FRACTION = 0.1;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      /** Fügt ein Spaltenlayout mit n leeren Spalten ein (2 bis 5). */
      insertColumns: (count: number) => ReturnType;
    };
    simpleBlocks: {
      insertTableOfContents: () => ReturnType;
      insertBreadcrumb: () => ReturnType;
    };
  }
}

/** Normiert Spaltenbreiten auf Summe 1; fehlende oder ungültige Werte werden gleich verteilt. */
export function normalizeColumnWidths(widths: (number | null | undefined)[]): number[] {
  const n = widths.length;
  if (!n) return [];
  const valid = widths.map((w) => (typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 0));
  const missing = valid.filter((w) => w === 0).length;
  const given = valid.reduce((a, b) => a + b, 0);
  if (missing === n || given <= 0) return widths.map(() => 1 / n);
  const fill = missing ? Math.max(given / (n - missing), 0.01) : 0;
  const raw = valid.map((w) => (w === 0 ? fill : w));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/** Verschiebt die Grenze zwischen Spalte i und i+1 um delta (Anteil), mit Mindestbreite. */
export function resizeColumns(widths: number[], index: number, delta: number): number[] {
  const w = normalizeColumnWidths(widths);
  if (index < 0 || index >= w.length - 1) return w;
  const pair = w[index]! + w[index + 1]!;
  const left = Math.min(
    pair - MIN_COLUMN_FRACTION,
    Math.max(MIN_COLUMN_FRACTION, w[index]! + delta),
  );
  w[index] = left;
  w[index + 1] = pair - left;
  return w;
}

/** Spalte innerhalb eines Spaltenlayouts. width: Anteil (0 bis 1), null = gleichmäßig. */
export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  defining: true,
  addAttributes() {
    return {
      width: {
        default: null,
        parseHTML: (el) => {
          const n = Number.parseFloat(el.getAttribute('data-width') ?? '');
          return Number.isFinite(n) && n > 0 && n <= 1 ? n : null;
        },
        renderHTML: (a) => (a.width ? { 'data-width': String(a.width) } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column' }), 0];
  },
});

/** Spaltenlayout mit 2 bis 5 Spalten. */
export const ColumnList = Node.create({
  name: 'columnList',
  group: 'block',
  content: `column{${MIN_COLUMNS},${MAX_COLUMNS}}`,
  isolating: true,
  defining: true,
  draggable: true,
  parseHTML() {
    return [{ tag: 'div[data-type="columnList"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'columnList' }), 0];
  },
  addCommands() {
    return {
      insertColumns:
        (count) =>
        ({ commands }) => {
          const n = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(count)));
          return commands.insertContent({
            type: 'columnList',
            content: Array.from({ length: n }, () => ({
              type: 'column',
              content: [{ type: 'paragraph' }],
            })),
          });
        },
    };
  },
});

/** Inhaltsverzeichnis: zeigt die Überschriften der Seite, wird im Browser live berechnet. */
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() {
    return [{ tag: 'div[data-type="tableOfContents"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'tableOfContents' })];
  },
  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: 'tableOfContents' }),
      insertBreadcrumb:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: 'breadcrumb' }),
    };
  },
});

/** Pfad der Seite (Breadcrumb) als Block. */
export const Breadcrumb = Node.create({
  name: 'breadcrumb',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() {
    return [{ tag: 'div[data-type="breadcrumb"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'breadcrumb' })];
  },
});

export interface HeadingEntry {
  id: string | null;
  level: number;
  text: string;
  pos: number;
}

/** Überschriften eines Dokuments in Reihenfolge (für das Inhaltsverzeichnis). */
export function collectHeadings(doc: PMNode): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      out.push({
        id: (node.attrs.id as string | null) ?? null,
        level: Number(node.attrs.level) || 1,
        text: node.textContent,
        pos,
      });
      return false;
    }
    // Überschriften in Tabellen zählen nicht
    return node.type.name !== 'table';
  });
  return out;
}
