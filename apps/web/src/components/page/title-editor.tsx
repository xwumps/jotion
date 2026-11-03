'use client';

import { PAGE_TITLE_MAX } from '@jotion/shared';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

interface Props {
  value: string;
  readOnly: boolean;
  placeholder: string;
  onSave: (title: string) => void;
  /** Enter bzw. Pfeil runter am Ende: in den Editor springen */
  onEnter?: () => void;
}

const SAVE_DELAY_MS = 400;

/**
 * Seitentitel als mitwachsende Textarea. Speichert verzögert beim Tippen und sofort beim
 * Verlassen. Während der Fokus im Feld liegt, überschreiben Server-Updates die Eingabe nicht.
 */
export const TitleEditor = forwardRef<HTMLTextAreaElement, Props>(function TitleEditor(
  { value, readOnly, placeholder, onSave, onEnter },
  ref,
) {
  const [draft, setDraft] = useState(value);
  const el = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(value);
  const latest = useRef(value);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  useImperativeHandle(ref, () => el.current!);

  useEffect(() => {
    if (document.activeElement !== el.current) {
      setDraft(value);
      lastSaved.current = value;
      latest.current = value;
    }
  }, [value]);

  useLayoutEffect(() => {
    const t = el.current;
    if (!t) return;
    t.style.height = '0px';
    t.style.height = `${t.scrollHeight}px`;
  }, [draft]);

  const flush = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (text !== lastSaved.current) {
      lastSaved.current = text;
      onSaveRef.current(text);
    }
  };

  // Beim Verlassen der Seite (Unmount) ausstehende Änderung sofort speichern
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (latest.current !== lastSaved.current) onSaveRef.current(latest.current);
      }
    },
    [],
  );

  return (
    <textarea
      ref={el}
      value={draft}
      readOnly={readOnly}
      rows={1}
      maxLength={PAGE_TITLE_MAX}
      placeholder={placeholder}
      aria-label={placeholder}
      data-testid="page-title"
      spellCheck
      onChange={(e) => {
        const text = e.target.value.replace(/\n/g, '');
        setDraft(text);
        latest.current = text;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(text), SAVE_DELAY_MS);
      }}
      onBlur={(e) => flush(e.target.value)}
      onKeyDown={(e) => {
        const atEnd = e.currentTarget.selectionStart === e.currentTarget.value.length;
        if (e.key === 'Enter' || (e.key === 'ArrowDown' && atEnd)) {
          e.preventDefault();
          flush(e.currentTarget.value);
          if (onEnter) onEnter();
          else e.currentTarget.blur();
        }
      }}
      className="block w-full resize-none overflow-hidden bg-transparent text-[40px] font-bold leading-[1.2] tracking-[-0.01em] text-fg outline-none placeholder:text-fg-subtle/60"
    />
  );
});
