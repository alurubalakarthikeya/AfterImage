import { cn } from '@/utils/format';

/**
 * The AfterImage mark: three offset apertures, the last one resolving.
 *
 * This is the artwork the desktop icon is drawn from — `scripts/generate-icons.mjs`
 * carries the same geometry — and it is deliberately not rendered anywhere in
 * the interface any more. Screens that showed a glyph beside the name now show
 * the name: at 21 pixels the mark was a smudge, and the word is the thing people
 * actually read.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      <rect
        x="1.25"
        y="1.25"
        width="29.5"
        height="29.5"
        rx="9"
        fill="var(--af-accent-soft)"
      />
      <rect x="7.5" y="7.5" width="12" height="12" rx="3.5" stroke="var(--af-accent)" strokeWidth="1.6" opacity="0.45" />
      <rect x="11" y="11" width="12" height="12" rx="3.5" stroke="var(--af-accent)" strokeWidth="1.6" opacity="0.75" />
      <rect x="14.5" y="14.5" width="11" height="11" rx="3.5" fill="var(--af-accent)" />
    </svg>
  );
}

/**
 * The wordmark.
 *
 * The name, at the size the place it sits in calls for. The product's identity
 * is three lines of text in the corner of a window that is otherwise all
 * pictures; a miniature logo competing with them was the one thing on the
 * screen with nothing to say.
 */
export function Logo({
  className,
  compact = false,
  size = 'md',
}: {
  className?: string;
  /** Name only, with no tagline underneath. */
  compact?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const typeface = {
    sm: 'text-body',
    md: 'text-[15px]',
    lg: 'text-card',
  }[size];

  return (
    <div className={cn('flex flex-col', className)}>
      <span
        className={cn(
          'truncate font-semibold leading-tight tracking-[-0.02em] text-ink',
          typeface,
        )}
      >
        AfterImage
      </span>
      {!compact && <span className="text-meta leading-tight text-ink-2">Your Digital Archive</span>}
    </div>
  );
}
