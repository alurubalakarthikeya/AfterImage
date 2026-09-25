import { useState } from 'react';
import { cn } from '@/utils/format';

/**
 * The wordmark's artwork, from `public/`.
 *
 * Served rather than inlined so the file stays the one the user drops into
 * `public/`: replacing `after-image-logo.png` and re-running the size step
 * changes the tab icon and the lockup together. `BASE_URL` rather than a
 * relative path, so the URL is correct whatever address the page was opened
 * from — a relative reference would resolve against the document, and this
 * application's route lives in a store rather than in the address bar.
 *
 * `alt` is empty because the name is written beside it; a screen reader should
 * hear "AfterImage" once, not twice.
 */
function LogoArt({ height }: { height: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo-mark-64.png`}
      alt=""
      aria-hidden="true"
      width={Math.round((height * 70) / 64)}
      height={height}
      onError={() => setFailed(true)}
      className="block shrink-0 object-contain select-none"
      style={{ height, width: 'auto' }}
      draggable={false}
    />
  );
}

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
  markOnly = false,
}: {
  className?: string;
  /** Name only, with no tagline underneath. */
  compact?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /**
   * The mark with no wordmark — what the phone's title bar shows.
   *
   * A 390 pixel window spends a third of its top bar on a name the user has
   * already read; the picture is the whole identity down there. It keeps an
   * accessible name of its own, because the word beside it on the desktop
   * build is what a screen reader would otherwise announce.
   */
  markOnly?: boolean;
}) {
  const typeface = {
    sm: 'text-body',
    md: 'text-[15px]',
    lg: 'text-card',
  }[size];

  // Deliberately small against the wordmark: the picture is an accent on the
  // name, not a second logo competing with it. 17px is the height of the
  // capital it sits beside, so the pair reads as one line.
  const markHeight = { sm: 17, md: 18, lg: 22 }[size];

  if (markOnly) {
    // A touch larger than the paired mark: with no word beside it, the size
    // that read as an accent reads as an accident.
    return (
      <span role="img" aria-label="AfterImage" className={cn('inline-flex items-center', className)}>
        <LogoArt height={20} />
      </span>
    );
  }

  return (
    <div className={cn('flex flex-row items-center gap-2', className)}>
      <LogoArt height={markHeight} />
      <div className="flex min-w-0 flex-col">
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
    </div>
  );
}
