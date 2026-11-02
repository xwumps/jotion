import type { SVGProps } from 'react';
import { cn } from '../cn';

/**
 * Jotion-Signet: ein Blatt mit gefalteter Ecke, darin ein "J".
 * Monochrom, nutzt currentColor und passt sich damit Light/Dark an.
 */
export function JotionMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn('size-6 shrink-0', className)}
      {...props}
    >
      <path
        d="M8 3.5h11.6c.5 0 1 .2 1.4.6l6.9 6.9c.4.4.6.9.6 1.4V25a3.5 3.5 0 0 1-3.5 3.5H8A3.5 3.5 0 0 1 4.5 25V7A3.5 3.5 0 0 1 8 3.5Z"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinejoin="round"
      />
      <path
        d="M20 4v5.5a2 2 0 0 0 2 2h6"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinejoin="round"
      />
      <path
        d="M17.5 13.5v6.25a4 4 0 0 1-7.6 1.75"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface JotionLogoProps {
  className?: string;
  showWordmark?: boolean;
}

/** Signet plus Wortmarke "Jotion". */
export function JotionLogo({ className, showWordmark = true }: JotionLogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-fg', className)}>
      <JotionMark />
      {showWordmark && (
        <span className="text-[17px] font-semibold tracking-[-0.01em] leading-none">Jotion</span>
      )}
    </span>
  );
}
