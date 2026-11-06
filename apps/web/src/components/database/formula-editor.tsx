'use client';

import {
  autocompletion,
  closeBrackets,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { linter, type Diagnostic } from '@codemirror/lint';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  check,
  evaluate,
  FormulaError,
  FUNCTIONS,
  toText,
  tokenize,
  typeName,
  type Type,
} from '@jotion/formula';
import type { DatabaseDto, MemberDto, RowDto } from '@jotion/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { propTypesOf, rowScope } from './formula-support';

/** Farbige Tokens: Text, Zahlen, Funktionen, prop("…"). */
function highlighter() {
  const mark = (cls: string) => Decoration.mark({ class: cls });
  const build = (view: EditorView): DecorationSet => {
    const b = new RangeSetBuilder<Decoration>();
    let toks: ReturnType<typeof tokenize> = [];
    try {
      toks = tokenize(view.state.doc.toString());
    } catch {
      return b.finish();
    }
    toks.forEach((t, i) => {
      if (t.start === t.end) return;
      const next = toks[i + 1];
      if (t.t === 'str') b.add(t.start, t.end, mark('cm-f-str'));
      else if (t.t === 'num') b.add(t.start, t.end, mark('cm-f-num'));
      else if (t.t === 'ident' && next?.t === 'op' && next.v === '(')
        b.add(t.start, t.end, mark(t.v === 'prop' ? 'cm-f-prop' : 'cm-f-fn'));
      else if (
        t.t === 'ident' &&
        ['true', 'false', 'current', 'index', 'and', 'or', 'not'].includes(t.v)
      )
        b.add(t.start, t.end, mark('cm-f-kw'));
    });
    return b.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

const theme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'var(--bg)' },
  '.cm-content': {
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    padding: '8px 0',
    caretColor: 'var(--fg)',
  },
  '.cm-line': { padding: '0 10px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-f-str': { color: 'var(--c-green, #448361)' },
  '.cm-f-num': { color: 'var(--c-orange, #d9730d)' },
  '.cm-f-fn': { color: 'var(--c-blue, #337ea9)' },
  '.cm-f-prop': { color: 'var(--c-purple, #9065b0)', fontWeight: '600' },
  '.cm-f-kw': { color: 'var(--c-pink, #c14c8a)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    color: 'var(--fg)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--hover)',
    color: 'var(--fg)',
  },
  '.cm-completionDetail': { color: 'var(--fg-subtle)', fontStyle: 'normal', marginLeft: '8px' },
});

export interface FormulaEditorProps {
  db: DatabaseDto;
  selfId?: string;
  initial: string;
  members: MemberDto[];
  /** Zeilen für die Vorschau */
  sampleRows: RowDto[];
  onChange: (expression: string, valid: boolean) => void;
}

/**
 * Formel-Editor: Hervorhebung, Autovervollständigung (Funktionen, Properties, current/index),
 * Fehler mit Position direkt im Text und Vorschau für eine Beispielzeile.
 */
export function FormulaEditor({
  db,
  selfId,
  initial,
  members,
  sampleRows,
  onChange,
}: FormulaEditorProps) {
  const t = useTranslations('database.formula');
  const host = useRef<HTMLDivElement>(null);
  const [expr, setExpr] = useState(initial);
  const types = useMemo(() => propTypesOf(db, selfId), [db, selfId]);
  const propNames = useMemo(() => Object.keys(types), [types]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const status = useMemo((): { type?: Type; error?: string; start?: number } => {
    if (!expr.trim()) return {};
    try {
      return { type: check(expr, { props: types }).type };
    } catch (err) {
      if (err instanceof FormulaError) return { error: err.message, start: err.start };
      throw err;
    }
  }, [expr, types]);

  const sample = sampleRows[0];
  const preview = useMemo(() => {
    if (!sample || status.error || !expr.trim()) return null;
    try {
      const v = evaluate(expr, {
        props: rowScope(db, sample, members),
        self: { kind: 'page', id: sample.id, title: sample.title },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      return toText(v, Intl.DateTimeFormat().resolvedOptions().timeZone) || '—';
    } catch (err) {
      return err instanceof Error ? `⚠ ${err.message}` : null;
    }
  }, [sample, status.error, expr, db, members]);

  useEffect(() => {
    if (!host.current) return;
    const completions = (ctx: CompletionContext) => {
      // prop("…") mit Property-Namen
      const inProp = ctx.matchBefore(/prop\(\s*["'][^"']*$/);
      if (inProp) {
        const quote = inProp.text.includes("'") ? "'" : '"';
        const from = inProp.from + inProp.text.lastIndexOf(quote) + 1;
        return {
          from,
          options: propNames.map<Completion>((n) => ({
            label: n,
            type: 'variable',
            apply: `${n}${quote})`,
            detail: typeName(types[n]!),
          })),
        };
      }
      const word = ctx.matchBefore(/[A-Za-z_À-ɏ]\w*/);
      if (!word && !ctx.explicit) return null;
      const from = word?.from ?? ctx.pos;
      const method = word ? ctx.state.sliceDoc(word.from - 1, word.from) === '.' : false;
      return {
        from,
        options: [
          ...FUNCTIONS.map<Completion>((f) => ({
            label: f.name,
            type: 'function',
            detail: f.doc,
            apply: `${f.name}(`,
            boost: method ? 0 : 1,
          })),
          ...(method
            ? []
            : propNames.map<Completion>((n) => ({
                label: `prop("${n}")`,
                type: 'variable',
                detail: typeName(types[n]!),
                boost: 2,
              }))),
          ...['current', 'index', 'true', 'false'].map<Completion>((k) => ({
            label: k,
            type: 'keyword',
          })),
        ],
      };
    };
    const lint = linter(
      (view) => {
        const src = view.state.doc.toString();
        if (!src.trim()) return [];
        try {
          check(src, { props: types });
          return [];
        } catch (err) {
          if (!(err instanceof FormulaError)) return [];
          const from = Math.min(err.start, src.length);
          const to = Math.max(from, Math.min(err.end, src.length));
          const d: Diagnostic = {
            from,
            to: to === from && from < src.length ? from + 1 : to,
            severity: 'error',
            message: err.message,
          };
          return [d];
        }
      },
      { delay: 250 },
    );
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          closeBrackets(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          autocompletion({ override: [completions], activateOnTyping: true }),
          lint,
          highlighter(),
          theme,
          EditorView.lineWrapping,
          cmPlaceholder(t('placeholder')),
          EditorView.contentAttributes.of({
            'aria-label': t('label'),
            'data-testid': 'formula-input',
          }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            const v = u.state.doc.toString();
            setExpr(v);
            let valid = true;
            try {
              check(v, { props: types });
            } catch {
              valid = false;
            }
            onChangeRef.current(v, valid && v.trim().length > 0);
          }),
        ],
      }),
    });
    view.focus();
    return () => view.destroy();
    // Der Editor entsteht einmal; Typen ändern sich während der Bearbeitung nicht
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={host}
        className="min-h-[90px] overflow-hidden rounded-md border border-border focus-within:border-accent"
      />
      <div className="min-h-[20px] text-[12px]" data-testid="formula-status" aria-live="polite">
        {status.error ? (
          <span className="text-[var(--c-red)]">⚠ {status.error}</span>
        ) : status.type ? (
          <span className="text-fg-muted">{t('resultType', { type: typeName(status.type) })}</span>
        ) : (
          <span className="text-fg-subtle">{t('hint')}</span>
        )}
      </div>
      {preview !== null && sample && (
        <div className="rounded-md bg-hover px-2 py-1.5 text-[12px]" data-testid="formula-preview">
          <span className="text-fg-subtle">{t('preview', { title: sample.title || '—' })}</span>{' '}
          <span className="font-medium">{preview}</span>
        </div>
      )}
    </div>
  );
}
