import type { ArchiveFile } from '@/types';
import { groupByDay } from '@/stores/selectors';
import { formatCount, formatDayLabel, formatClock } from '@/utils/format';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonRows } from '@/components/common/Skeleton';
import { FileCard } from './FileCard';

/**
 * Timeline view.
 *
 * Reuses the card, but in a uniform grid under sticky day headers — the
 * compromise that makes an archive readable as a history rather than a pile.
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
      {groups.map((group) => (
        <section key={group.label} className="flex flex-col gap-3">
          <div className="sticky top-0 z-10 -mx-1 flex items-baseline gap-2 bg-canvas/85 px-1 py-2 backdrop-blur-sm">
            <h3 className="text-body font-semibold text-ink">
              {formatDayLabel(group.files[0].createdAt)}
            </h3>
            <span className="text-2xs text-ink-3">{formatCount(group.files.length)} files</span>
            <span className="ml-auto text-2xs tabular-nums text-ink-3">
              {formatClock(group.files[0].createdAt)}
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {group.files.slice(0, 12).map((file) => (
              <FileCard key={file.id} file={file} onOpen={onOpen} />
            ))}
          </div>
          {group.files.length > 12 && (
            <div className="text-2xs text-ink-3">
              + {formatCount(group.files.length - 12)} more on this day
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
