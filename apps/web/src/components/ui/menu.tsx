'use client';

import * as M from '@radix-ui/react-dropdown-menu';
import { cn } from '@jotion/ui';
import type { ComponentProps, ComponentType, ReactNode } from 'react';

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[220px] rounded-lg bg-bg-elevated p-1 text-fg shadow-popover outline-none',
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

interface MenuItemProps extends ComponentProps<typeof M.Item> {
  icon?: ComponentType<{ className?: string }>;
  destructive?: boolean;
  shortcut?: string;
  children: ReactNode;
}

export function MenuItem({
  icon: Icon,
  destructive,
  shortcut,
  className,
  children,
  ...props
}: MenuItemProps) {
  return (
    <M.Item
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[14px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover',
        destructive && 'text-[var(--c-red)]',
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="size-4 shrink-0 opacity-80" />}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="text-[12px] text-fg-subtle">{shortcut}</span>}
    </M.Item>
  );
}

export function MenuCheckboxItem({
  checked,
  onCheckedChange,
  children,
  icon: Icon,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  children: ReactNode;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <M.Item
      onSelect={(e) => {
        e.preventDefault();
        onCheckedChange(!checked);
      }}
      className="flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[14px] outline-none data-[highlighted]:bg-hover"
    >
      {Icon && <Icon className="size-4 shrink-0 opacity-80" />}
      <span className="flex-1">{children}</span>
      <span
        role="switch"
        aria-checked={checked}
        className={cn(
          'relative h-[14px] w-[26px] rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-active',
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] size-[10px] rounded-full bg-white transition-all',
            checked ? 'left-[14px]' : 'left-[2px]',
          )}
        />
      </span>
    </M.Item>
  );
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <M.Label className="px-2 pb-1 pt-1.5 text-[12px] font-medium text-fg-subtle">
      {children}
    </M.Label>
  );
}
