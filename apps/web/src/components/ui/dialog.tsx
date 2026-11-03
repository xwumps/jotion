'use client';

import * as D from '@radix-ui/react-dialog';
import { cn } from '@jotion/ui';
import type { ComponentProps, ReactNode } from 'react';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  title,
  description,
  children,
  ...props
}: ComponentProps<typeof D.Content> & { title: string; description?: ReactNode }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <D.Content
        className={cn(
          'fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-[480px] -translate-x-1/2 rounded-xl bg-bg-elevated p-5 text-fg shadow-popover outline-none',
          className,
        )}
        {...props}
      >
        <D.Title className="text-[16px] font-semibold">{title}</D.Title>
        {description ? (
          <D.Description className="mt-1 text-[14px] text-fg-muted">{description}</D.Description>
        ) : (
          <D.Description className="sr-only">{title}</D.Description>
        )}
        <div className="mt-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
