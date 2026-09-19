import type { ReactNode } from 'react';
import { cn } from '@/utils/format';

/**
 * CSS-only tooltip.
 *
 * No portal, no positioning library, no re-render: for a desktop shell with
 * predictable chrome, a delayed absolutely-positioned label is enough. The
 * delay keeps tooltips from flickering while the pointer sweeps the toolbar.
 */
export function Tooltip({
  label,
  shortcut,
  side = 'bottom',
  children,
  className,
}: {
  label: string;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
  className?: string;
}) {
  const position = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }[side];

  return (
    <span className={cn('group/tt relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 hidden items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1',
          'text-2xs font-medium text-white shadow-raised',
          // Hidden while closed: an always-laid-out label anchored near the
          // window edge would either widen the shell or be clipped by it.
          'af-tooltip group-hover/tt:flex',
          position,
        )}
        style={{ backgroundColor: 'rgba(20, 33, 36, 0.92)' }}
      >
        {label}
        {shortcut && (
          <kbd className="rounded border border-white/20 px-1 py-px font-sans text-[10px] text-white/70">
            {shortcut}
          </kbd>
        )}
      </span>
    </span>
  );
}
