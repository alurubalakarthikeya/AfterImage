import { cn } from '@/utils/format';

/**
 * The AfterImage mark: three offset apertures, the last one resolving.
 *
 * Geometric, no gradient, no glow — the visual shorthand for "layered frames
 * that remember what passed through them".
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

export function Logo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={compact ? 26 : 30} />
      {!compact && (
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-tight tracking-[-0.02em] text-ink">
            AfterImage
          </div>
          <div className="text-meta leading-tight text-ink-2">Your Digital Archive</div>
        </div>
      )}
    </div>
  );
}
