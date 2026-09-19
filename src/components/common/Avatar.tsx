import { cn } from '@/utils/format';

/** Initials avatar. The archive is local, so there is no remote image to load. */
export function Avatar({
  name,
  size = 32,
  className,
  tone = 'accent',
}: {
  name: string;
  size?: number;
  className?: string;
  tone?: 'accent' | 'neutral';
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-[-0.01em]',
        tone === 'accent' ? 'bg-accent-soft text-accent-ink' : 'bg-surface-3 text-ink-2',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {initials || '?'}
    </span>
  );
}
