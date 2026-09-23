import { useMemo, type ReactNode } from 'react';
import type { ArchiveFile, FileKind } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { KIND_EMPTY, KIND_ICON } from '@/stores/selectors';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonCard } from '@/components/common/Skeleton';
import { FileCard } from './FileCard';

/**
 * The gallery.
 *
 * A uniform grid of equal tiles, the way every file and photo browser works:
 * predictable column count, predictable row height, captions on one line. An
 * earlier version sized every tile from its own aspect ratio, which was
 * visually busy and made scanning a grid of 200 screenshots materially harder —
 * variety in a file browser is noise, not personality.
 *
 * Selection lives in the UI store, keyboard movement in `useKeyboardShortcuts`
 * (which walks the DOM in visual order), and range selection is resolved by the
 * store from the ordered ids this view supplies.
 */
export function FileGrid({
  files,
  minColumn = 208,
  className,
  emptyTitle,
  emptyDescription,
  emptyAction,
  kind,
  onOpen,
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
  /** True while the page is still being read from the index. */
  loading?: boolean;
}) {
  const selectedIds = useUIStore((state) => state.selectedFileIds);
  const openFile = useArchiveStore((state) => state.openFile);
  const showMeta = useSettingsStore((state) => state.showThumbnailMeta);
  const order = useMemo(() => files.map((file) => file.id), [files]);

  const handleOpen = onOpen ?? ((file: ArchiveFile) => void openFile(file.id));

  if (files.length === 0) {
    if (loading) {
      return (
        <div
          className={['grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4', className]
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        >
          {Array.from({ length: 8 }).map((_, index) => (
            <SkeletonCard key={index} aspect={4 / 3} />
          ))}
        </div>
      );
    }
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
      role="listbox"
      aria-label="Files"
      aria-multiselectable
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minColumn}px), 1fr))`,
        gap: '20px 16px',
      }}
    >
      {files.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          order={order}
          showMeta={showMeta}
          selected={selectedIds.includes(file.id)}
          onOpen={handleOpen}
        />
      ))}
    </div>
  );
}
