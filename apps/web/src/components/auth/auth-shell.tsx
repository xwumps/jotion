import { JotionLogo } from '@jotion/ui';
import type { ReactNode } from 'react';

export function AuthShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[340px]">
        <div className="mb-8 flex justify-center">
          <JotionLogo className="[&_svg]:size-8 [&>span]:text-[22px]" />
        </div>
        <h1 className="text-center text-[22px] font-semibold tracking-[-0.01em]">{title}</h1>
        {intro && <p className="mt-2 text-center text-[14px] text-fg-muted">{intro}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export const submitClass =
  'h-9 w-full rounded-md bg-accent text-[14px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60';
