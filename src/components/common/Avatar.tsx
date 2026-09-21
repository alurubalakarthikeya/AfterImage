import { cn } from '@/utils/format';
import { Icon } from './Icon';

/**
 * Initials avatar. The archive is local, so there is no remote image to load.
 *
 * With no name yet — which is the state on first launch, before the local
 * account has been read — this draws a neutral glyph rather than a question
 * mark, which would read as a loading failure instead of "not set".
 */
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
        tone === 'accent' ? 'bg-surface-3 text-ink' : 'bg-surface-3 text-ink-2',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {initials || <Icon name="User" size={Math.round(size * 0.5)} strokeWidth={1.9} />}
    </span>
  );
}
