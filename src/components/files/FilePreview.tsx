import type { ArchiveFile } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { cn, formatDuration } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { FileThumb, ThumbChip } from '@/components/common/FileThumb';
import { Tooltip } from '@/components/common/Tooltip';

/**
 * The inspector's media surface.
 *
 * Sits on a sunken backdrop so a screenshot's own light background still reads
 * as an image, with the controls the user actually reaches for on hover.
 */
export function FilePreview({
  file,
  height = 180,
  className,
  showActions = true,
}: {
  file: ArchiveFile;
  height?: number;
  className?: string;
  showActions?: boolean;
}) {
  const openFile = useArchiveStore((state) => state.openFile);
  const revealFile = useArchiveStore((state) => state.revealFile);
  const copyPath = useArchiveStore((state) => state.copyPath);
  const toggleFavorite = useArchiveStore((state) => state.toggleFavorite);

  const hasImage = file.kind !== 'document' && file.kind !== 'audio' && file.kind !== 'archive';

  return (
    <div
      className={cn(
        'group/preview relative overflow-hidden rounded-thumb border border-line',
        className,
      )}
      style={{ backgroundColor: 'var(--af-surface-sunken)', height }}
    >
      {hasImage ? (
        <div className="flex h-full w-full items-center justify-center p-2">
          <FileThumb
            file={file}
            fill
            className="h-full w-auto max-w-full overflow-hidden rounded-[10px]"
            rounded="rounded-[10px]"
          />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <FileThumb file={file} fill className="h-full w-full" rounded="rounded-none" />
        </div>
      )}

      {file.durationSec !== undefined && (
        <div className="absolute bottom-2 right-2">
          <ThumbChip icon="Film">{formatDuration(file.durationSec)}</ThumbChip>
        </div>
      )}

      {showActions && (
        <div className="absolute left-2 top-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/preview:opacity-100 group-focus-within/preview:opacity-100">
          <Tooltip label="Open" side="bottom">
            <button
              type="button"
              aria-label="Open file"
              onClick={() => void openFile(file.id)}
              className="glass-chrome inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/25 text-ink transition-colors duration-150 hover:bg-surface"
            >
              <Icon name="ExternalLink" size={14} strokeWidth={2} />
            </button>
          </Tooltip>
          <Tooltip label="Open location" side="bottom">
            <button
              type="button"
              aria-label="Open location"
              onClick={() => void revealFile(file.id)}
              className="glass-chrome inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/25 text-ink transition-colors duration-150 hover:bg-surface"
            >
              <Icon name="FolderOpen" size={14} strokeWidth={2} />
            </button>
          </Tooltip>
          <Tooltip label="Copy path" side="bottom">
            <button
              type="button"
              aria-label="Copy path"
              onClick={() => void copyPath(file.id)}
              className="glass-chrome inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/25 text-ink transition-colors duration-150 hover:bg-surface"
            >
              <Icon name="Copy" size={14} strokeWidth={2} />
            </button>
          </Tooltip>
        </div>
      )}

      <div className="absolute right-2 top-2 opacity-0 transition-opacity duration-150 group-hover/preview:opacity-100 group-focus-within/preview:opacity-100">
        <Tooltip label={file.favorite ? 'Remove favourite' : 'Favourite'} side="bottom">
          <button
            type="button"
            aria-label="Toggle favourite"
            onClick={() => toggleFavorite(file.id)}
            className={cn(
              'glass-chrome inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/25 transition-colors duration-150 hover:bg-surface',
              file.favorite ? 'text-accent-ink' : 'text-ink',
            )}
          >
            <Icon name="Star" size={14} strokeWidth={2} fill={file.favorite ? 'currentColor' : 'none'} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
