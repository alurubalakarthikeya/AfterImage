import type { ReactNode } from 'react';
import { Icon } from '@/components/common/Icon';
import { Card } from '@/components/common/Card';

/**
 * The Settings page's two layout primitives, in one place.
 *
 * They live here rather than inside the page because a settings *section* is now
 * something more than one component draws: the organizer is its own file, and a
 * second copy of these two blocks would be a second visual definition of what a
 * settings row looks like.
 */
export function Section({
  title,
  description,
  children,
  icon,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  icon: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-ink-2">
          <Icon name={icon} size={15} strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-card font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-meta text-ink-2">{description}</p>}
          <div className="mt-4 flex flex-col gap-3">{children}</div>
        </div>
      </div>
    </Card>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    // `flex-wrap` and the gap pair rather than a single gap: on a narrow
    // screen the control drops beneath its label instead of pushing the row
    // wider than the page. `max-w-full` is what lets it stop at the row's own
    // width when the control has a fixed size — a control wider than its row
    // would otherwise stay on its own line and hang over the edge of the
    // window. On any screen wide enough to hold both on one line the rendering
    // is exactly what it was before.
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line pb-3 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-body text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-2xs text-ink-3">{hint}</div>}
      </div>
      <div className="max-w-full shrink-0">{children}</div>
    </div>
  );
}
