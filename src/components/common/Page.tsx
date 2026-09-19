import type { ReactNode } from 'react';
import { cn } from '@/utils/format';

/**
 * Page frame.
 *
 * Every route body is the same two things: a stack of blocks with one gap, and
 * a scroll container that must not grow a stray margin at the bottom. Sharing
 * it here is what keeps the spacing identical across ten pages instead of
 * nearly identical across ten pages.
 */
export function Page({
  children,
  className,
  container = false,
}: {
  children: ReactNode;
  className?: string;
  /** True when the page sizes anything with container queries. */
  container?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-4', container && '@container', className)}>
      {children}
    </div>
  );
}

/**
 * A section of a page: optional header, then content, with the same rhythm the
 * page itself uses so nesting stays visually consistent.
 */
export function PageSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn('flex flex-col gap-3', className)}>{children}</section>;
}
