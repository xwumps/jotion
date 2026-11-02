import { cn } from '@jotion/ui';
import type { InputHTMLAttributes, ReactNode } from 'react';

export const inputClass =
  'h-9 w-full rounded-md border border-border bg-bg px-2.5 text-[14px] outline-none transition-shadow placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60';

export function Field({
  label,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-fg-muted">{label}</span>
      <input className={cn(inputClass, className)} {...props} />
      {hint && <span className="mt-1 block text-[12px] text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-md bg-[var(--cb-red)] px-3 py-2 text-[13px] text-[var(--c-red)]"
    >
      {children}
    </p>
  );
}
