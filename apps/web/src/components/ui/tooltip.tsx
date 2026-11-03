'use client';

import * as T from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export const TooltipProvider = T.Provider;

export function Tooltip({
  label,
  children,
  side = 'bottom',
}: {
  label: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <T.Root delayDuration={400}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-md bg-[#0f0f0f] px-2 py-1 text-[12px] font-medium text-white/90 shadow-popover dark:bg-[#3a3a3a]"
        >
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
