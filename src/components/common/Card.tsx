import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/utils/format';
import { LinkButton } from './Button';

/** The base surface: white, hairline border, one very soft shadow. */
export function Card({
  className,
  children,
  large = false,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { large?: boolean }) {
  return (
    <div
      className={cn(
        'relative rounded-card border border-line bg-surface',
        large && 'rounded-card-lg',
        className,
      )}
      style={{ boxShadow: 'var(--af-shadow-soft)', ...rest.style }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

/** Title + optional count + optional trailing link, consistent everywhere. */
export function SectionHeader({
  title,
  subtitle,
  count,
  actionLabel,
  onAction,
  actionIcon = 'ArrowRight',
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[18px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
          {count !== undefined && (
            <span className="text-meta tabular-nums text-ink-3">
              {count.toLocaleString('en-US')}
            </span>
          )}
        </div>
        {subtitle && <p className="mt-0.5 text-meta text-ink-2">{subtitle}</p>}
      </div>
      {children}
      {actionLabel && <LinkButton onClick={onAction} icon={actionIcon}>{actionLabel}</LinkButton>}
    </div>
  );
}

/** Full-card empty/placeholder block, used inside grids and panels. */
export function Placeholder({
  children,
  className,
  dashed = false,
}: {
  children: ReactNode;
  className?: string;
  dashed?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-thumb bg-surface-2 p-6 text-center',
        dashed && 'border border-dashed border-line-strong bg-transparent',
        className,
      )}
    >
      {children}
    </div>
  );
}
