import type { ArchiveFile } from '@/types';
import { useUIStore } from '@/stores/ui';
import { useRelatedFiles } from '@/hooks/useFileInsights';
import { KindLabel } from '@/components/files/KindLabel';
import { AssetImage } from '@/components/common/AssetImage';
import { SkeletonRows } from '@/components/common/Skeleton';
import { formatRelativeTime } from '@/utils/format';

/**
 * Related files.
 *
 * The list comes from the index: shared tags, shared text terms, the same
 * folder, the same project, proximity in time, and visual similarity when the
 * local model is installed. Nothing is picked at random, and when the index has
 * nothing to offer, this says so instead of padding the panel.
 */
export function RelatedFiles({ file }: { file: ArchiveFile }) {
  const selectFile = useUIStore((state) => state.selectFile);
  const { hits, loading, error } = useRelatedFiles(file.id, 3);

  if (loading) return <SkeletonRows rows={1} />;

  if (error) {
    return <p className="text-meta text-ink-3">Related files need the desktop build.</p>;
  }

  if (hits.length === 0) {
    return (
      <p className="text-meta leading-relaxed text-ink-3">
        No related files found yet. Tag this file, add it to a project, or let the index reach more
        of your folders and connections will appear here.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {hits.map((hit) => (
        <button
          key={hit.file.id}
          type="button"
          onClick={() => selectFile(hit.file.id)}
          className="group/related flex flex-col gap-1.5 text-left"
          title={hit.file.name}
        >
          <span className="relative block overflow-hidden rounded-[10px] border border-line transition-[border-color,transform] duration-150 group-hover/related:-translate-y-px group-hover/related:border-line-strong">
            <span className="block" style={{ aspectRatio: '1' }}>
              <AssetImage path={hit.file.thumbPath} alt={hit.file.name} />
            </span>
          </span>
          <span className="min-w-0">
            <span className="line-clamp-filename text-2xs text-ink-2 group-hover/related:text-ink">
              {hit.file.generatedTitle ?? hit.file.name}
            </span>
            <span className="line-clamp-filename text-[10px] text-ink-3">
              {formatRelativeTime(hit.file.createdAt)} · <KindLabel kind={hit.file.kind} />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
