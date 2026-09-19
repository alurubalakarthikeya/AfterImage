import { cn } from '@/utils/format';

/** Thin, quiet progress. Never the loudest thing on screen. */
export function ProgressBar({
  value,
  max = 1,
  className,
  tone = 'accent',
  height = 4,
  segments,
}: {
  value: number;
  max?: number;
  className?: string;
  tone?: 'accent' | 'caution' | 'critical' | 'ink';
  height?: number;
  /** Optional stacked breakdown, drawn left to right in the given order. */
  segments?: Array<{ value: number; className: string }>;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const toneClass = {
    accent: 'bg-accent',
    caution: 'bg-caution',
    critical: 'bg-critical',
    ink: 'bg-ink-2',
  }[tone];

  return (
    <div
      className={cn('w-full overflow-hidden rounded-pill bg-sunken', className)}
      style={{ height }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
    >
      {segments && segments.length > 0 ? (
        <div className="flex h-full w-full">
          {segments.map((segment, index) => (
            <div
              key={index}
              className={cn('h-full first:rounded-l-pill last:rounded-r-pill', segment.className)}
              style={{ width: `${max > 0 ? (segment.value / max) * 100 : 0}%` }}
            />
          ))}
        </div>
      ) : (
        <div
          className={cn('h-full rounded-pill transition-[width] duration-500 ease-out', toneClass)}
          style={{ width: `${ratio * 100}%` }}
        />
      )}
    </div>
  );
}

/** Indeterminate variant for "working, unknown duration". */
export function IndeterminateBar({ className }: { className?: string }) {
  return (
    <div className={cn('relative h-1 w-full overflow-hidden rounded-pill bg-sunken', className)}>
      <div className="absolute inset-y-0 w-1/3 animate-[af-slide_1.4s_ease-in-out_infinite] rounded-pill bg-accent/70" />
    </div>
  );
}
