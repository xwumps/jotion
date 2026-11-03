'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '../ui/dialog';

const SHORTCUTS: { keys: string; id: string }[] = [
  { keys: 'Strg/⌘ K', id: 'search' },
  { keys: 'Strg/⌘ B', id: 'bold' },
  { keys: 'Strg/⌘ I', id: 'italic' },
  { keys: 'Strg/⌘ U', id: 'underline' },
  { keys: 'Strg/⌘ ⇧ S', id: 'strike' },
  { keys: 'Strg/⌘ E', id: 'code' },
  { keys: 'Strg/⌘ Z', id: 'undo' },
  { keys: 'Strg/⌘ ⇧ Z', id: 'redo' },
  { keys: 'Strg/⌘ ⌥ 1/2/3', id: 'heading' },
  { keys: 'Strg/⌘ ⇧ 7', id: 'numbered' },
  { keys: 'Strg/⌘ ⇧ 8', id: 'bullet' },
  { keys: 'Strg/⌘ ⇧ 9', id: 'todo' },
  { keys: '/', id: 'slash' },
  { keys: '# ## ###', id: 'mdHeading' },
  { keys: '- oder *', id: 'mdBullet' },
  { keys: '1.', id: 'mdNumbered' },
  { keys: '[]', id: 'mdTodo' },
  { keys: '>', id: 'mdToggle' },
  { keys: '"', id: 'mdQuote' },
  { keys: '```', id: 'mdCode' },
  { keys: '---', id: 'mdDivider' },
];

/** Übersicht der Tastaturkürzel (Strg/Cmd + /). */
export function ShortcutsDialog() {
  const t = useTranslations('shortcuts');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title={t('title')} className="max-w-[440px]">
        <dl className="max-h-[60vh] divide-y divide-border overflow-y-auto">
          {SHORTCUTS.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-1.5 text-[14px]">
              <dt className="text-fg-muted">{t(s.id)}</dt>
              <dd>
                <kbd className="rounded border border-border bg-hover px-1.5 py-0.5 font-sans text-[12px]">
                  {s.keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
