import { useArchiveStore } from '@/stores/archive';
import { activityByKind } from '@/stores/selectors';
import { useUIStore } from '@/stores/ui';
import { cn, formatRelativeTime } from '@/utils/format';
import { SectionHeader } from '@/components/common/Card';
import { StatusDot } from '@/components/common/Badge';

/**
 * Activity.
 *
 * Built from the mutation log, so every row corresponds to something that
 * genuinely happened to the archive. It is a list with hairlines rather than a
 * card with a timeline graphic: the container was adding a border, a radius and
 * a curved connector to information that reads perfectly well as plain rows.
 */
export function ActivityTimeline({ className, limit = 6 }: { className?: string; limit?: number }) {
  const activity = useArchiveStore((state) => state.activity);
  const selectFile = useUIStore((state) => state.selectFile);
  const navigate = useUIStore((state) => state.navigate);

  const entries = activityByKind(activity).slice(0, limit);

  return (
    <section className={cn('flex flex-col', className)} aria-label="Recent activity">
      <SectionHeader title="Activity" actionLabel="See all" onAction={() => navigate('home')} />

      {entries.length === 0 ? (
        <p className="mt-3 text-meta text-ink-3">
          Nothing yet. Adding a folder, tagging a file or finishing an indexing run shows up here.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => entry.fileId && selectFile(entry.fileId)}
                disabled={!entry.fileId}
                className={cn(
                  'group/act flex w-full items-baseline gap-2.5 py-2 text-left',
                  entry.fileId && 'cursor-pointer',
                )}
              >
                <span className="relative top-[-1px]">
                  <StatusDot kind={entry.kind} ring={false} />
                </span>
                <span className="min-w-0 flex-1">
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
                </span>
                <span className="shrink-0 text-2xs tabular-nums text-ink-3">
                  {formatRelativeTime(entry.at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
