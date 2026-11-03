import { InputRule, mergeAttributes, Node } from '@tiptap/core';

export const MAX_LATEX_LENGTH = 4000;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      insertMathBlock: (latex?: string) => ReturnType;
      insertMathInline: (latex?: string) => ReturnType;
    };
    mention: {
      insertMention: (attrs: MentionAttrs) => ReturnType;
    };
  }
}

const latexAttr = {
  latex: {
    default: '',
    parseHTML: (el: HTMLElement) =>
      (el.getAttribute('data-latex') ?? el.textContent ?? '').slice(0, MAX_LATEX_LENGTH),
    renderHTML: (a: Record<string, unknown>) => ({ 'data-latex': String(a.latex ?? '') }),
  },
};

/** Formel als eigener Block (KaTeX, Anzeige-Modus). */
export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => latexAttr,
  parseHTML() {
    return [{ tag: 'div[data-type="mathBlock"]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mathBlock' }),
      String(node.attrs.latex ?? ''),
    ];
  },
  addCommands() {
    return {
      insertMathBlock:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: 'mathBlock', attrs: { latex } }),
      insertMathInline:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: 'mathInline', attrs: { latex } }),
    };
  },
});

/** Formel im Fließtext. Eingabe wie bei Notion: `$$x^2$$`. */
export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => latexAttr,
  parseHTML() {
    return [{ tag: 'span[data-type="mathInline"]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mathInline' }),
      String(node.attrs.latex ?? ''),
    ];
  },
  renderText({ node }) {
    return String(node.attrs.latex ?? '');
  },
  addInputRules() {
    return [
      new InputRule({
        find: /\$\$([^$\n]{1,4000})\$\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1]?.trim();
          if (!latex) return null;
          state.tr.replaceWith(range.from, range.to, this.type.create({ latex }));
        },
      }),
    ];
  },
});

export const MENTION_KINDS = ['user', 'page', 'date'] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];

export interface MentionAttrs {
  kind: MentionKind;
  /** Nutzer- oder Seiten-ID */
  targetId?: string | null;
  /** Datum als ISO (YYYY-MM-DD) bei kind = date */
  date?: string | null;
  /**
   * Anzeigename beim Einfügen (nur für Personen). Seitentitel werden bewusst nie gespeichert,
   * damit Titel privater Seiten nicht in geteilten Dokumenten landen.
   */
  label?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Erwähnung von Person, Seite oder Datum (`@`). */
export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      kind: {
        default: 'user',
        parseHTML: (el) => {
          const k = el.getAttribute('data-kind');
          return (MENTION_KINDS as readonly string[]).includes(k ?? '') ? k : 'user';
        },
        renderHTML: (a) => ({ 'data-kind': a.kind }),
      },
      targetId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-target-id'),
        renderHTML: (a) => (a.targetId ? { 'data-target-id': a.targetId } : {}),
      },
      date: {
        default: null,
        parseHTML: (el) => {
          const d = el.getAttribute('data-date');
          return d && DATE_RE.test(d) ? d : null;
        },
        renderHTML: (a) => (a.date ? { 'data-date': a.date } : {}),
      },
      label: {
        default: null,
        parseHTML: (el) =>
          el.getAttribute('data-kind') === 'user' ? el.getAttribute('data-label') : null,
        renderHTML: (a) => (a.label && a.kind === 'user' ? { 'data-label': a.label } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mention' }),
      mentionText(node.attrs as MentionAttrs),
    ];
  },
  renderText({ node }) {
    return mentionText(node.attrs as MentionAttrs);
  },
  addCommands() {
    return {
      insertMention:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent([
            {
              type: 'mention',
              attrs: {
                kind: attrs.kind,
                targetId: attrs.kind === 'date' ? null : (attrs.targetId ?? null),
                date: attrs.kind === 'date' ? (attrs.date ?? null) : null,
                label: attrs.kind === 'user' ? (attrs.label ?? null) : null,
              },
            },
            { type: 'text', text: ' ' },
          ]),
    };
  },
});

/** Klartext einer Erwähnung (Suche, Kopieren). Seiten ohne Titel, siehe MentionAttrs.label. */
export function mentionText(a: Partial<MentionAttrs>): string {
  if (a.kind === 'date') return a.date && DATE_RE.test(a.date) ? `@${a.date}` : '';
  if (a.kind === 'user') return a.label ? `@${a.label}` : '@';
  return '';
}
