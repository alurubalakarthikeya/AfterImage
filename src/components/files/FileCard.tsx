import { memo } from 'react';
import type { ArchiveFile } from '@/types';
import { useUIStore } from '@/stores/ui';
import { cn, formatBytes, formatDuration, formatResolution, formatRelativeTime, splitExtension } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { FileThumb } from '@/components/common/FileThumb';
import { Tooltip } from '@/components/common/Tooltip';

/**
 * One file in the gallery.
 *
 * The tile is a thumbnail and two lines of text. There is no card border, no
 * badge for the file's kind and no drop shadow: a grid of 200 of these should
 * read as a grid of pictures, not as 200 floating panels. Meta information is
 * the numbers a person actually uses to tell two screenshots apart — size and
 * pixel dimensions — rather than a coloured label repeating the page they are
 * already on.
 *
 * Selection is a two-pixel accent outline plus a filled corner mark, which stays
 * legible on a dark screenshot, a white document and a pale photo alike.
 */
export interface FileCardProps {
  file: ArchiveFile;
  selected?: boolean;
  showMeta?: boolean;
  /** Ordered ids of everything in this view, for shift-range selection. */
  order?: string[];
  onOpen?: (file: ArchiveFile) => void;
  className?: string;
}

export const FileCard = memo(function FileCard({
  file,
  selected = false,
  showMeta = true,
  order,
  onOpen,
  className,
}: FileCardProps) {
  const { stem, ext } = splitExtension(file.name);
  const processing = file.indexState === 'pending' || file.indexState === 'processing';
  const failed = file.indexState === 'failed' || file.indexState === 'missing';

  const handleSelect = (event: React.MouseEvent) => {
    const ui = useUIStore.getState();
    if (event.shiftKey && order && order.length > 0) {
      ui.selectFile(file.id, { range: true, rangeOrder: order });
      return;
    }
    ui.selectFile(file.id, { additive: event.metaKey || event.ctrlKey });
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
      className={cn('group/card flex cursor-default flex-col text-left', className)}
      aria-selected={selected}
      role="option"
      tabIndex={-1}
    >
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-thumb border transition-colors duration-150',
          selected
            ? 'border-accent'
            : 'border-line group-hover/card:border-line-strong',
        )}
        style={{ aspectRatio: '4 / 3' }}
      >
        <FileThumb file={file} fill className="h-full w-full" rounded="rounded-none" />

        {selected && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[inherit]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--af-accent)' }}
          />
        )}

        {/* Only two overlays exist: a favourite star, and a state a person needs
            to know about. Everything else is text below the tile. */}
        <div className="pointer-events-none absolute inset-x-1.5 top-1.5 flex items-start justify-between gap-1.5">
          <span className="flex items-center gap-1.5">
            {selected && (
              <span
                className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-accent p-[3px] text-white"
                aria-hidden="true"
              >
                <Icon name="Check" size={11} strokeWidth={3} />
              </span>
            )}
            {file.favorite && (
              <span
                className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-white"
                style={{ backgroundColor: 'rgba(15,21,20,0.55)' }}
                title="Favourite"
              >
                <Icon name="Star" size={10} strokeWidth={2} fill="currentColor" />
              </span>
            )}
            {processing && (
              <span
                className="inline-flex h-[18px] items-center gap-1 rounded-[5px] px-1.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: 'rgba(15,21,20,0.58)' }}
                title="Still being processed"
              >
                <span className="h-1 w-1 animate-pulse rounded-full bg-white" />
                {file.indexState === 'processing' ? 'processing' : 'queued'}
              </span>
            )}
            {failed && (
              <span
                className="inline-flex h-[18px] items-center gap-1 rounded-[5px] px-1.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: 'rgba(120,52,34,0.85)' }}
              >
                <Icon name="AlertTriangle" size={10} strokeWidth={2.4} />
                {file.indexState === 'missing' ? 'not on disk' : 'failed'}
              </span>
            )}
          </span>
          {file.durationSec !== undefined && (
            <span
              className="pointer-events-none inline-flex items-center rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-white"
              style={{ backgroundColor: 'rgba(15,21,20,0.68)' }}
            >
              {formatDuration(file.durationSec)}
            </span>
          )}
        </div>

        {/* The overflow menu appears on hover, and on keyboard focus. */}
        <div className="absolute bottom-1.5 right-1.5 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 group-focus-within/card:opacity-100">
          <Tooltip label="More actions" side="top">
            <button
              type="button"
              aria-label={`Actions for ${file.name}`}
              onClick={(event) => {
                event.stopPropagation();
                const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                useUIStore.getState().openContextMenu(rect.left - 140, rect.top, file.id);
              }}
              className="glass-chrome inline-flex h-6 w-6 items-center justify-center rounded-[6px] border border-white/25 text-ink transition-colors duration-150 hover:bg-surface"
            >
              <Icon name="MoreHorizontal" size={13} strokeWidth={2.2} />
            </button>
          </Tooltip>
        </div>
      </div>

      {showMeta && (
        <div className="mt-1.5 flex min-w-0 flex-col">
          <span
            className={cn(
              'line-clamp-filename text-body',
              selected ? 'font-medium text-accent-ink' : 'text-ink',
            )}
            title={file.path}
            data-selectable
          >
            {stem}
            <span className="text-ink-3">{ext}</span>
          </span>
          <span className="line-clamp-filename text-2xs tabular-nums text-ink-3">
            {metaLine(file)}
            <span aria-hidden="true"> · </span>
            {formatRelativeTime(file.modifiedAt)}
          </span>
        </div>
      )}
    </article>
  );
});

/** Size and shape, which is what distinguishes one screenshot from another. */
function metaLine(file: ArchiveFile): string {
  const resolution = formatResolution(file.width, file.height);
  if (resolution) return `${formatBytes(file.bytes)} · ${resolution}`;
  return formatBytes(file.bytes);
}
