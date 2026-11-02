'use client';

import * as P from '@radix-ui/react-popover';
import { cn } from '@jotion/ui';
import type { ComponentProps } from 'react';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-lg bg-bg-elevated text-fg shadow-popover outline-none',
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}
