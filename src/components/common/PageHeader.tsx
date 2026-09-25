import type { ReactNode } from 'react';
import { cn, formatCount } from '@/utils/format';
import { Icon } from './Icon';

/** Consistent page title block: name, count, context, trailing controls. */
export function PageHeader({
  title,
  subtitle,
  count,
  icon,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  icon?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon && (
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
              <Icon name={icon} size={14} strokeWidth={1.9} />
            </span>
          )}
          <h1 className="truncate text-title font-semibold tracking-[-0.02em] text-ink">{title}</h1>
          {count !== undefined && (
            <span className="text-meta tabular-nums text-ink-3">{formatCount(count)} files</span>
          )}
        </div>
        {subtitle && <p className="mt-1 text-meta text-ink-2">{subtitle}</p>}
      </div>
      {children && (
        // Wrapped rather than forced onto one line: at a phone's width the
        // toolbar breaks into rows instead of hanging over the edge of the
        // window, and wide enough to hold them the controls sit right-aligned
        // exactly as before.
        <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
      )}
    </header>
  );
}
