import { memo } from 'react';
import type { ArchiveFile } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { KIND_LABEL } from '@/stores/selectors';
import { useUIStore } from '@/stores/ui';
import { cn, formatBytes, formatRelativeTime, formatResolution } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { FileThumb } from '@/components/common/FileThumb';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonRows } from '@/components/common/Skeleton';

const GRID_COLUMNS = 'minmax(0, 1fr) 118px 168px 96px 132px';

const FileRow = memo(function FileRow({
  file,
  selected,
  onOpen,
}: {
  file: ArchiveFile;
  selected: boolean;
  onOpen: (file: ArchiveFile) => void;
}) {
  return (
    <div
      data-file-id={file.id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={(event) =>
        useUIStore.getState().selectFile(file.id, {
          additive: event.metaKey || event.ctrlKey || event.shiftKey,
        })
      }
      onDoubleClick={() => onOpen(file)}
      onContextMenu={(event) => {
        event.preventDefault();
        useUIStore.getState().openContextMenu(event.clientX, event.clientY, file.id);
      }}
      className={cn(
        'grid items-center gap-3 border-b border-line px-3 py-2 transition-colors duration-100 last:border-b-0',
        selected ? 'bg-accent-softer' : 'hover:bg-surface-2',
      )}
      style={{ gridTemplateColumns: GRID_COLUMNS }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <FileThumb file={file} aspect={1} rounded="rounded-[8px]" className="h-8 w-8 shrink-0" />
        <span className="min-w-0">
          <span className="line-clamp-filename text-body text-ink" title={file.name}>
            {file.name}
          </span>
          <span className="line-clamp-filename text-2xs text-ink-3">
            {file.favorite ? '★ ' : ''}
            {file.indexState !== 'indexed' ? `${file.indexState} · ` : ''}
            {file.folderPath}
          </span>
        </span>
      </div>
      <span className="truncate text-meta text-ink-2">{KIND_LABEL[file.kind]}</span>
      <span className="truncate text-meta text-ink-3">
        {formatResolution(file.width, file.height) ?? '—'}
      </span>
      <span className="text-right text-meta tabular-nums text-ink-2">{formatBytes(file.bytes)}</span>
      <span className="text-right text-meta text-ink-3">{formatRelativeTime(file.modifiedAt)}</span>
    </div>
  );
});

export function FileList({
  files,
  onOpen,
  loading = false,
  emptyTitle,
  emptyDescription,
}: {
  files: ArchiveFile[];
  onOpen?: (file: ArchiveFile) => void;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const selectedIds = useUIStore((state) => state.selectedFileIds);
  const openFile = useArchiveStore((state) => state.openFile);
  const handleOpen = onOpen ?? ((file: ArchiveFile) => void openFile(file.id));

  if (files.length === 0) {
    if (loading) return <SkeletonRows rows={8} />;
    return (
      <EmptyState
        icon="Files"
        title={emptyTitle ?? 'No files yet'}
        description={emptyDescription}
      />
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Files"
      aria-multiselectable
      className="overflow-hidden rounded-card border border-line bg-surface"
      style={{ boxShadow: 'var(--af-shadow-soft)' }}
    >
      <div
        className="grid items-center gap-3 border-b border-line bg-surface-2 px-3 py-2"
        style={{ gridTemplateColumns: GRID_COLUMNS }}
      >
        <span className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
          Name
          <Icon name="ArrowDownUp" size={11} strokeWidth={2} />
        </span>
        <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">Type</span>
        <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
          Dimensions
        </span>
        <span className="text-right text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
          Size
        </span>
        <span className="text-right text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
          Modified
        </span>
      </div>
      {files.map((file) => (
        <FileRow
          key={file.id}
          file={file}
          selected={selectedIds.includes(file.id)}
          onOpen={handleOpen}
        />
      ))}
    </div>
  );
}
