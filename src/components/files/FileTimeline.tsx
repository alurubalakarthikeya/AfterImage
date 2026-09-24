import type { ArchiveFile } from '@/types';
import { groupByDay } from '@/stores/selectors';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { formatCount, formatDayLabel, formatClock } from '@/utils/format';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonRows } from '@/components/common/Skeleton';
import { FileCard } from './FileCard';

/**
 * Timeline view.
 *
 * Reuses the card, but in a uniform grid under sticky day headers — the
 * compromise that makes an archive readable as a history rather than a pile.
 *
 * The headers are controls, not decoration. A day in this list is a question
 * the index can answer on its own — "everything from the 14th" — and asking it
 * is a click, so a day with more files than fit on screen does not end in a
 * dead "+ 240 more". Paging is handled by the page the view already sits on,
 * which is why this only ever sets a filter and never loads anything itself.
 */
export function FileTimeline({
  files,
  onOpen,
  loading = false,
}: {
  files: ArchiveFile[];
  onOpen?: (file: ArchiveFile) => void;
  loading?: boolean;
}) {
  const groups = groupByDay(files);
  const showMeta = useSettingsStore((state) => state.showThumbnailMeta);
  const activeDay = useUIStore((state) => state.activeDay);
  const setActiveDay = useUIStore((state) => state.setActiveDay);

  if (groups.length === 0) {
    if (loading) return <SkeletonRows rows={8} />;
    return (
      <EmptyState
        icon="Clock"
        title="No history yet"
        description="Files appear here as they are indexed from your watched folders."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => {
        const selected = activeDay === group.key;
        return (
          <section key={group.key} className="flex flex-col gap-3">
            <div className="sticky top-0 z-10 -mx-1 flex items-baseline gap-2 bg-canvas/85 px-1 py-2 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setActiveDay(selected ? null : group.key)}
                aria-pressed={selected}
                title={selected ? 'Show every day' : `Show everything from this day`}
                className={
                  selected
                    ? 'rounded-lg bg-surface-3 px-1.5 text-body font-semibold text-ink'
                    : 'rounded-lg px-1.5 text-body font-semibold text-ink transition-colors duration-150 hover:bg-surface-3'
                }
              >
                {formatDayLabel(group.files[0].createdAt)}
              </button>
              <span className="text-2xs text-ink-3">{formatCount(group.files.length)} files</span>
              <span className="ml-auto text-2xs tabular-nums text-ink-3">
                {formatClock(group.files[0].createdAt)}
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {group.files.slice(0, 12).map((file) => (
                <FileCard key={file.id} file={file} showMeta={showMeta} onOpen={onOpen} />
              ))}
            </div>
            {group.files.length > 12 && (
              <button
                type="button"
                onClick={() => setActiveDay(group.key)}
                className="-mt-1 w-fit text-2xs text-ink-3 transition-colors duration-150 hover:text-accent-ink"
              >
                View all {formatCount(group.files.length)} from this day →
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
