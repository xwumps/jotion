'use client';

import { COVER_GRADIENTS, type PageCover } from '@jotion/shared';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api-client';
import { GRADIENTS } from '@/lib/covers';
import { uploadImage } from '@/lib/upload';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

export function CoverPicker({
  workspaceId,
  onSelect,
  children,
}: {
  workspaceId: string;
  onSelect: (c: PageCover | null) => void;
  children: ReactNode;
}) {
  const t = useTranslations('page');
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const choose = (c: PageCover | null) => {
    onSelect(c);
    setOpen(false);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const f = await uploadImage(workspaceId, file);
      choose({ type: 'file', fileId: f.id, positionY: 50 });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-3">
        <div className="mb-2 text-[12px] font-medium text-fg-subtle">{t('gradients')}</div>
        <div className="grid grid-cols-3 gap-2">
          {COVER_GRADIENTS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => choose({ type: 'gradient', value: g })}
              className="h-14 rounded-md ring-offset-2 ring-offset-bg-elevated hover:ring-2 hover:ring-accent"
              style={{ background: GRADIENTS[g] }}
              aria-label={g}
            />
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="h-8 flex-1 rounded-md border border-border text-[14px] hover:bg-hover disabled:opacity-60"
          >
            {uploading ? t('uploading') : t('uploadImage')}
          </button>
          <button
            type="button"
            onClick={() => choose(null)}
            className="h-8 rounded-md px-3 text-[14px] text-fg-muted hover:bg-hover"
          >
            {t('removeCover')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
