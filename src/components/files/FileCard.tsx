import { memo } from 'react';
import type { ArchiveFile } from '@/types';
import { useUIStore } from '@/stores/ui';
import { KIND_LABEL } from '@/stores/selectors';
import { cn, formatDuration, formatRelativeTime, splitExtension } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { FileThumb, ThumbChip } from '@/components/common/FileThumb';
import { Tooltip } from '@/components/common/Tooltip';

/**
 * A file card.
 *
 * Kept free of store subscriptions: the grid may render hundreds of these, so
 * everything arrives as props and handlers read stores imperatively. Hover is
 * a gentle lift plus a hairline shadow change — no scale on the card itself,
 * which would blur the text.
 */
export interface FileCardProps {
  file: ArchiveFile;
  selected?: boolean;
  /** Explicit thumbnail height, used by the masonry grid. */
  thumbHeight?: number;
  showMeta?: boolean;
  onOpen?: (file: ArchiveFile) => void;
  className?: string;
}

export const FileCard = memo(function FileCard({
  file,
  selected = false,
  thumbHeight,
  showMeta = true,
  onOpen,
  className,
}: FileCardProps) {
  const { stem, ext } = splitExtension(file.name);
  const processing = file.indexState === 'pending' || file.indexState === 'processing';
  const failed = file.indexState === 'failed' || file.indexState === 'missing';

  const handleSelect = (event: React.MouseEvent) => {
    useUIStore.getState().selectFile(file.id, {
      additive: event.metaKey || event.ctrlKey || event.shiftKey,
    });
  };

  return (
    <article
      data-file-id={file.id}
      data-file-kind={file.kind}
      onClick={handleSelect}
      onDoubleClick={() => onOpen?.(file)}
      onContextMenu={(event) => {
        event.preventDefault();
        useUIStore.getState().openContextMenu(event.clientX, event.clientY, file.id);
      }}
      className={cn(
        'group/card flex h-full cursor-default flex-col overflow-hidden rounded-[14px] border bg-surface',
        'transition-[transform,box-shadow,border-color] duration-150 ease-out',
        'hover:-translate-y-px',
        selected ? 'border-accent/60' : 'border-line hover:border-line-strong',
        className,
      )}
      style={{
        boxShadow: selected ? 'var(--af-shadow-raised)' : 'var(--af-shadow-soft)',
      }}
      aria-selected={selected}
      role="option"
      tabIndex={-1}
    >
      <div
        className="relative w-full shrink-0 overflow-hidden"
        style={thumbHeight ? { height: thumbHeight } : undefined}
      >
        <div className="h-full w-full transition-transform duration-300 ease-out group-hover/card:scale-[1.02]">
          <FileThumb file={file} fill className="h-full w-full" rounded="rounded-none" />
        </div>

        {/* Chips — only when they carry information. */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
          <span className="flex gap-1.5">
            {file.favorite && (
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-md text-white"
                style={{ backgroundColor: 'rgba(15,21,20,0.55)' }}
              >
                <Icon name="Star" size={11} strokeWidth={2} fill="currentColor" />
              </span>
            )}
            {processing && (
              <span
                className="inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: 'rgba(15,21,20,0.55)' }}
              >
                <span className="h-1 w-1 animate-pulse rounded-full bg-white" />
                indexing
              </span>
            )}
            {failed && (
              <span
                className="inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: 'rgba(120,52,34,0.82)' }}
              >
                <Icon name="AlertTriangle" size={10} strokeWidth={2.2} />
                {file.indexState === 'missing' ? 'missing' : 'failed'}
              </span>
            )}
            {file.embeddingState === 'unavailable' && (file.kind === 'photo' || file.kind === 'screenshot') && (
              <span
                className="inline-flex h-5 items-center rounded-md px-1.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: 'rgba(15,21,20,0.45)' }}
                title="No embedding model is installed, so this file is findable by text only"
              >
                text only
              </span>
            )}
          </span>
          {file.durationSec !== undefined && (
            <ThumbChip>{formatDuration(file.durationSec)}</ThumbChip>
          )}
          {file.pages !== undefined && file.pages > 1 && (
            <ThumbChip icon="FileText">{file.pages}p</ThumbChip>
          )}
        </div>

        {/* Controls appear on hover only. */}
        <div className="absolute right-2 bottom-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 group-focus-within/card:opacity-100">
          <Tooltip label="More actions" side="top">
            <button
              type="button"
              aria-label="More actions"
              onClick={(event) => {
                event.stopPropagation();
                const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                useUIStore.getState().openContextMenu(rect.left, rect.bottom + 4, file.id);
              }}
              className="glass-chrome inline-flex h-6 w-6 items-center justify-center rounded-lg border border-white/25 text-ink transition-colors duration-150 hover:bg-surface"
            >
              <Icon name="MoreHorizontal" size={14} strokeWidth={2.2} />
            </button>
          </Tooltip>
        </div>
      </div>

      {showMeta && (
        <div className="flex shrink-0 flex-col gap-0.5 px-3 py-2.5">
          <span
            className="line-clamp-filename text-body font-medium text-ink"
            title={file.name}
            data-selectable
          >
            {stem}
            <span className="text-ink-3">{ext}</span>
          </span>
          <span className="flex items-center gap-1.5 text-2xs text-ink-3">
            <span className="shrink-0">{formatRelativeTime(file.modifiedAt)}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{KIND_LABEL[file.kind]}</span>
          </span>
        </div>
      )}
    </article>
  );
});
