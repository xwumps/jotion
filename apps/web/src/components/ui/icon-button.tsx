import { cn } from '@jotion/ui';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

/** Kleiner, quadratischer Knopf für Hover-Aktionen (Sidebar, Topbar). */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function IconButton({ className, type = 'button', ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-[5px] text-fg-muted transition-colors hover:bg-active hover:text-fg [&_svg]:size-4',
          className,
        )}
        {...props}
      />
    );
  },
);
