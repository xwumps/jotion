import type { PageIcon as PageIconValue } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { FileText } from 'lucide-react';

/** Seiten-Icon: Emoji, hochgeladenes Bild oder Standard-Dokumentsymbol. */
export function PageIcon({
  icon,
  className,
  size = 18,
}: {
  icon: PageIconValue | null;
  className?: string;
  size?: number;
}) {
  if (icon?.type === 'emoji') {
    return (
      <span
        aria-hidden
        className={cn('inline-flex shrink-0 items-center justify-center leading-none', className)}
        style={{ fontSize: size * 0.95, width: size, height: size }}
      >
        {icon.value}
      </span>
    );
  }
  if (icon?.type === 'file') {
    return (
      <img
        src={`/api/files/${icon.fileId}`}
        alt=""
        className={cn('shrink-0 rounded-[3px] object-cover', className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <FileText
      aria-hidden
      className={cn('shrink-0 text-fg-subtle', className)}
      style={{ width: size, height: size }}
      strokeWidth={1.75}
    />
  );
}
