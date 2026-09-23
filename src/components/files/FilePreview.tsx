import { useState } from 'react';
import type { ArchiveFile } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { cn, formatDuration } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { FileThumb, ThumbChip } from '@/components/common/FileThumb';
import { PromptDialog } from '@/components/common/PromptDialog';
import { Tooltip } from '@/components/common/Tooltip';
import { canRenderOriginal } from './MediaViewer';

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
  const renameFile = useArchiveStore((state) => state.renameFile);
  const setSelectedFileId = useUIStore((state) => state.selectFile);
  const setQuickLookOpen = useUIStore((state) => state.setQuickLookOpen);
  const [renaming, setRenaming] = useState(false);

  const hasImage = file.kind !== 'document' && file.kind !== 'audio' && file.kind !== 'archive';
  // A video or a PDF is worth opening in the viewer rather than reading as a
  // still: this panel is 180 pixels tall, and the player needs the room.
  const renderable = canRenderOriginal(file);

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

      {renderable && (
        <button
          type="button"
          onClick={() => {
            setSelectedFileId(file.id);
            setQuickLookOpen(true);
          }}
          className="glass-chrome absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-lg border border-white/25 px-2 py-1 text-2xs font-medium text-ink transition-colors duration-150 hover:bg-surface"
        >
          <Icon name={file.kind === 'audio' ? 'Music' : file.kind === 'video' ? 'Play' : 'FileText'} size={12} strokeWidth={2} />
          {file.kind === 'video' ? 'Play' : file.kind === 'audio' ? 'Listen' : 'Read'}
        </button>
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
          <Tooltip label="Rename" side="bottom">
            <button
              type="button"
              aria-label="Rename file"
              onClick={() => setRenaming(true)}
              className="glass-chrome inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/25 text-ink transition-colors duration-150 hover:bg-surface"
            >
              <Icon name="Pencil" size={14} strokeWidth={2} />
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

      {/* Renaming here as well as in the context menu: the inspector is where a
          file is looked at closely, and the moment somebody notices a name is
          wrong is the moment they are looking at it. */}
      <PromptDialog
        open={renaming}
        title="Rename file"
        description="The file is renamed on disk, in the folder it already lives in. Its extension is kept unless you type another one."
        initialValue={file.name}
        placeholder="File name"
        confirmLabel="Rename"
        onConfirm={(name) => void renameFile(file.id, name)}
        onClose={() => setRenaming(false)}
      />

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

