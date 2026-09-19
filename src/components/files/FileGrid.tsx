import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ArchiveFile, FileKind } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { KIND_EMPTY, KIND_ICON } from '@/stores/selectors';
import { useUIStore } from '@/stores/ui';
import { aspectForFile } from '@/components/common/FileThumb';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonCard } from '@/components/common/Skeleton';
import { FileCard } from './FileCard';

/** Placeholder tiles shown while the first page is being read. */
function SkeletonTiles({ className }: { className?: string }) {
  return (
    <div
      className={['grid grid-cols-2 gap-4 sm:grid-cols-3', className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {[1.33, 0.75, 1, 1.33, 1, 0.75].map((aspect, index) => (
        <SkeletonCard key={index} aspect={aspect} />
      ))}
    </div>
  );
}

const ROW_UNIT = 8;
const GAP = 16;
const META_HEIGHT = 52;
/** Wide feature cards are paced through the grid rather than clustered. */
const WIDE_EVERY = 9;

interface LayoutItem {
  file: ArchiveFile;
  colSpan: number;
  rowSpan: number;
  thumbHeight: number;
}

/**
 * Masonry layout.
 *
 * CSS columns would be simpler, but they flow top-to-bottom, which ruins a
 * "most recent first" grid. So we measure the container, work out the column
 * width, then give every card an explicit row span in a dense grid: left to
 * right ordering, genuine size variety, no layout library.
 */
function useMasonryLayout(files: ArchiveFile[], minColumn: number, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((current) => (Math.abs(current - next) > 1 ? next : current));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!enabled || width <= 0) {
      return {
        columns: 1,
        items: files.map<LayoutItem>((file) => ({
          file,
          colSpan: 1,
          rowSpan: 0,
          thumbHeight: 0,
        })),
        masonry: false,
      };
    }

    const columns = Math.max(1, Math.floor((width + GAP) / (minColumn + GAP)));
    const columnWidth = (width - GAP * (columns - 1)) / columns;

    const items = files.map<LayoutItem>((file, index) => {
      const wide = columns >= 3 && index > 0 && index % WIDE_EVERY === 0;
      const colSpan = wide ? 2 : 1;
      const itemWidth = columnWidth * colSpan + GAP * (colSpan - 1);
      const aspect = aspectForFile(file) ?? 1.4;
      const thumbHeight = Math.round(itemWidth / aspect);
      const total = thumbHeight + META_HEIGHT;
      const rowSpan = Math.ceil((total + GAP) / (ROW_UNIT + GAP));
      return { file, colSpan, rowSpan, thumbHeight };
    });

    return { columns, items, masonry: true };
  }, [files, minColumn, width, enabled]);

  return { ref, layout };
}

export function FileGrid({
  files,
  minColumn = 220,
  className,
  emptyTitle,
  emptyDescription,
  emptyAction,
  kind,
  onOpen,
  animate = false,
  loading = false,
}: {
  files: ArchiveFile[];
  /** Column width floor; the appearance settings raise this. */
  minColumn?: number;
  className?: string;
  /** Defaults to the copy that belongs to `kind`. */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Extra element under the empty state — a "pick a folder" button, say. */
  emptyAction?: ReactNode;
  /** Forces a kind-specific empty state for pages that know their kind. */
  kind?: FileKind;
  onOpen?: (file: ArchiveFile) => void;
  animate?: boolean;
  /** True while the page is still being read from the index. */
  loading?: boolean;
}) {
  const selectedIds = useUIStore((state) => state.selectedFileIds);
  const openFile = useArchiveStore((state) => state.openFile);
  const { ref, layout } = useMasonryLayout(files, minColumn, true);

  const handleOpen = onOpen ?? ((file: ArchiveFile) => void openFile(file.id));

  if (files.length === 0) {
    if (loading) return <SkeletonTiles className={className} />;
    const fallback = kind ? KIND_EMPTY[kind] : null;
    return (
      <EmptyState
        icon={kind ? KIND_ICON[kind] : 'Files'}
        title={emptyTitle ?? fallback?.title ?? 'No files yet'}
        description={emptyDescription ?? fallback?.detail}
        secondary={emptyAction}
      />
    );
  }

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Files"
      aria-multiselectable
      className={className}
      style={
        layout.masonry
          ? {
              display: 'grid',
              gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
              gridAutoRows: `${ROW_UNIT}px`,
              gridAutoFlow: 'dense',
              gap: `${GAP}px`,
            }
          : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: `${GAP}px` }
      }
    >
      {layout.items.map((item, index) => (
        <div
          key={item.file.id}
          style={
            layout.masonry ? { gridColumn: `span ${item.colSpan}`, gridRow: `span ${item.rowSpan}` } : undefined
          }
          className={animate ? 'af-fade-in' : undefined}
          data-animate-index={animate ? index : undefined}
        >
          <FileCard
            file={item.file}
            selected={selectedIds.includes(item.file.id)}
            thumbHeight={layout.masonry ? item.thumbHeight : undefined}
            onOpen={handleOpen}
          />
        </div>
      ))}
    </div>
  );
}
