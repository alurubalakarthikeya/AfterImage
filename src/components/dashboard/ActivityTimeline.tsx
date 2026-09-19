import { useArchiveStore } from '@/stores/archive';
import { activityByKind } from '@/stores/selectors';
import { useUIStore } from '@/stores/ui';
import { cn, formatRelativeTime } from '@/utils/format';
import { Card, SectionHeader } from '@/components/common/Card';
import { StatusDot } from '@/components/common/Badge';

/**
 * Activity.
 *
 * Built from the mutation log, so every entry here corresponds to something
 * that genuinely happened to the archive — no decorative feed.
 */
export function ActivityTimeline({ className, limit = 6 }: { className?: string; limit?: number }) {
  const activity = useArchiveStore((state) => state.activity);
  const selectFile = useUIStore((state) => state.selectFile);
  const navigate = useUIStore((state) => state.navigate);

  const entries = activityByKind(activity).slice(0, limit);

  return (
    <Card className={cn('flex flex-col p-4', className)}>
      <SectionHeader
        title="Activity"
        actionLabel="See all"
        onAction={() => navigate('home')}
      />

      <ol className="relative mt-4 flex-1">
        {/* The connector is a hairline, not a graphic. */}
        <span
          aria-hidden="true"
          className="absolute left-[3px] top-2 bottom-2 w-px"
          style={{ backgroundColor: 'var(--af-line)' }}
        />
        {entries.map((entry, index) => (
          <li key={entry.id} className={cn('relative flex gap-3', index > 0 && 'pt-3.5')}>
            <span className="relative z-10 mt-[5px] flex h-[7px] w-[7px] shrink-0 items-center justify-center">
              <StatusDot kind={entry.kind} ring={false} />
            </span>
            <button
              type="button"
              onClick={() => entry.fileId && selectFile(entry.fileId)}
              disabled={!entry.fileId}
              className={cn(
                'min-w-0 flex-1 text-left',
                entry.fileId && 'group/act cursor-pointer',
              )}
            >
              <span
                className={cn(
                  'block truncate text-meta text-ink',
                  entry.fileId && 'transition-colors duration-150 group-hover/act:text-accent-ink',
                )}
              >
                {entry.label}
              </span>
              {entry.detail && (
                <span className="mt-px block truncate font-mono text-[10.5px] text-ink-3">
                  {entry.detail}
                </span>
              )}
              <span className="mt-px block text-2xs text-ink-3">{formatRelativeTime(entry.at)}</span>
            </button>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="text-meta text-ink-3">Nothing has happened yet.</li>
        )}
      </ol>
    </Card>
  );
}
