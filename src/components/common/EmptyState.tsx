import type { ReactNode } from 'react';
import { cn } from '@/utils/format';
import { Button } from './Button';
import { Icon } from './Icon';

/**
 * Empty states.
 *
 * Deliberately undersized: an archive that has just been set up is the normal
 * case, not an error, so this reads as an invitation rather than a warning.
 */
export function EmptyState({
  icon = 'Files',
  title,
  description,
  actionLabel,
  onAction,
  secondary,
  className,
  compact = false,
}: {
  icon?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondary?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-2xl bg-surface-2 text-ink-3',
          compact ? 'h-10 w-10' : 'h-12 w-12',
        )}
      >
        <Icon name={icon} size={compact ? 18 : 20} strokeWidth={1.8} />
      </div>
      <div className="max-w-[340px]">
        <h3 className={cn('font-semibold text-ink', compact ? 'text-body' : 'text-[15px]')}>{title}</h3>
        {description && <p className="mt-1 text-meta leading-relaxed text-ink-2">{description}</p>}
      </div>
      {actionLabel && onAction && (
        <Button size="sm" variant="secondary" icon="Plus" onClick={onAction} className="mt-1">
          {actionLabel}
        </Button>
      )}
      {secondary}
    </div>
  );
}
