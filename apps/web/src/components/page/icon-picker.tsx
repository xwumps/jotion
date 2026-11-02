'use client';

import type { PageIcon as PageIconValue } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { Shuffle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api-client';
import { EMOJI_GROUPS, randomEmoji } from '@/lib/emojis';
import { uploadImage } from '@/lib/upload';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

interface Props {
  workspaceId: string;
  onSelect: (icon: PageIconValue | null) => void;
  children: ReactNode;
  hasIcon: boolean;
}

/** Icon-Auswahl: Emoji-Raster, Zufall, eigenes Bild hochladen, entfernen. */
export function IconPicker({ workspaceId, onSelect, children, hasIcon }: Props) {
  const t = useTranslations('page');
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'emoji' | 'upload'>('emoji');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const choose = (icon: PageIconValue | null) => {
    onSelect(icon);
    setOpen(false);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const f = await uploadImage(workspaceId, file);
      choose({ type: 'file', fileId: f.id });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[352px] p-0" aria-label={t('iconPicker')}>
        <div className="flex items-center gap-1 border-b border-border px-2 pt-2">
          {(['emoji', 'upload'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                '-mb-px border-b-2 px-2 pb-2 text-[14px]',
                tab === id
                  ? 'border-fg font-medium text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {t(id === 'emoji' ? 'emojiTab' : 'uploadTab')}
            </button>
          ))}
          <div className="ml-auto flex gap-1 pb-1.5">
            <button
              type="button"
              onClick={() => choose({ type: 'emoji', value: randomEmoji() })}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover"
              title={t('randomEmoji')}
            >
              <Shuffle className="size-3.5" />
            </button>
            {hasIcon && (
              <button
                type="button"
                onClick={() => choose(null)}
                className="h-7 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover"
              >
                {t('removeIcon')}
              </button>
            )}
          </div>
        </div>
        {tab === 'emoji' ? (
          <div className="max-h-[300px] overflow-y-auto p-2">
            {EMOJI_GROUPS.map((g) => (
              <div key={g.id} className="mb-2">
                <div className="px-1 pb-1 text-[12px] font-medium text-fg-subtle">
                  {t(`emojiGroups.${g.id}`)}
                </div>
                <div className="grid grid-cols-10">
                  {g.emojis.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => choose({ type: 'emoji', value: e })}
                      className="flex size-8 items-center justify-center rounded-md text-[22px] hover:bg-hover"
                      aria-label={e}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="h-8 w-full rounded-md border border-border text-[14px] hover:bg-hover disabled:opacity-60"
            >
              {uploading ? t('uploading') : t('uploadImage')}
            </button>
            <p className="mt-2 text-center text-[12px] text-fg-subtle">{t('uploadHint')}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
