import { useEffect } from 'react';
import type { ArchiveFile } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { KIND_SINGULAR } from '@/stores/selectors';
import { cn, formatAbsolute, formatBytes, formatCount, formatResolution } from '@/utils/format';
import { Modal } from '@/components/common/Overlay';
import { Icon } from '@/components/common/Icon';
import { IconButton } from '@/components/common/IconButton';
import { FileThumb } from '@/components/common/FileThumb';
import { ExtractedText } from './ExtractedText';

/**
 * Quick look.
 *
 * Space opens it, arrows move through what the route is showing, Esc closes.
 *
 * It renders the preview the pipeline generated at scan time — the webview has
 * no access to the original file, by design — and says so, with a button that
 * hands the file to the system's own viewer when more detail is needed.
 */
export function QuickLook() {
  const open = useUIStore((state) => state.quickLookOpen);
  const setOpen = useUIStore((state) => state.setQuickLookOpen);
  const selectedId = useUIStore((state) => state.selectedFileId);
  const selectFile = useUIStore((state) => state.selectFile);
  const openFile = useArchiveStore((state) => state.openFile);
  const revealFile = useArchiveStore((state) => state.revealFile);
  // The working set drives the arrow keys — it is what the user is looking at —
  // while `known` covers a selection that came from search or the palette.
  const files = useArchiveStore((state) => state.files);
  const known = useArchiveStore((state) => state.known);

  const index = files.findIndex((file) => file.id === selectedId);
  const file: ArchiveFile | undefined =
    index >= 0 ? files[index] : selectedId ? known[selectedId] : undefined;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = files[index + 1];
        if (next) selectFile(next.id);
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        const previous = files[index - 1];
        if (previous) selectFile(previous.id);
      }
      if (event.key === 'Enter' && file) {
        event.preventDefault();
        void openFile(file.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, files, index, selectFile, openFile, file]);

  return (
    <Modal open={open && Boolean(file)} onClose={() => setOpen(false)} className="max-w-[900px]">
      {file && (
        <div className="flex flex-col">
          <div
            className="relative flex items-center justify-center p-6"
            style={{ backgroundColor: 'var(--af-surface-sunken)' }}
          >
            <div className="max-h-[440px] max-w-full overflow-hidden rounded-thumb">
              <FileThumb
                file={file}
                fill
                className="max-h-[420px] w-auto"
                rounded="rounded-thumb"
                eager
              />
            </div>

            <div className="absolute left-4 top-4 flex items-center gap-1">
              <IconButton
                size="sm"
                variant="soft"
                label="Previous"
                onClick={() => {
                  const previous = files[index - 1];
                  if (previous) selectFile(previous.id);
                }}
              >
                <Icon name="ChevronLeft" size={15} strokeWidth={2.2} />
              </IconButton>
              <IconButton
                size="sm"
                variant="soft"
                label="Next"
                onClick={() => {
                  const next = files[index + 1];
                  if (next) selectFile(next.id);
                }}
              >
                <Icon name="ChevronRight" size={15} strokeWidth={2.2} />
              </IconButton>
              <span className="ml-1 rounded-pill bg-surface/85 px-2 py-0.5 text-2xs tabular-nums text-ink-2">
                {formatCount(index + 1)} / {formatCount(files.length)}
              </span>
            </div>

            <div className="absolute right-4 top-4 flex items-center gap-1">
              <IconButton size="sm" variant="soft" label="Open" onClick={() => void openFile(file.id)}>
                <Icon name="ExternalLink" size={15} strokeWidth={2} />
              </IconButton>
              <IconButton
                size="sm"
                variant="soft"
                label="Open location"
                onClick={() => void revealFile(file.id)}
              >
                <Icon name="FolderOpen" size={15} strokeWidth={2} />
              </IconButton>
              <IconButton size="sm" variant="soft" label="Close" onClick={() => setOpen(false)}>
                <Icon name="X" size={15} strokeWidth={2.2} />
              </IconButton>
            </div>

            <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-pill bg-surface/85 px-2.5 py-0.5 text-[10px] text-ink-3">
              {file.thumbPath ? 'Local preview · generated from this file' : 'No preview generated'}
            </span>
          </div>

          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-semibold text-ink" data-selectable>
                  {file.generatedTitle ?? file.name}
                </h2>
                <p className="mt-0.5 truncate font-mono text-[11px] text-ink-3" title={file.path}>
                  {file.path}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-2xs text-ink-3">
                <span>{KIND_SINGULAR[file.kind]}</span>
                <span>{formatResolution(file.width, file.height) ?? '—'}</span>
                <span>{formatBytes(file.bytes)}</span>
              </div>
            </div>

            {file.description && (
              <p className="text-meta leading-relaxed text-ink-2">{file.description}</p>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-3">
              <span>{formatAbsolute(file.createdAt)}</span>
              <span className="truncate">{file.folderPath}</span>
              {file.tagIds.length > 0 && (
                <span className={cn('text-ink-2')}>{file.tagIds.length} tags</span>
              )}
            </div>

            {file.ocrText && <ExtractedText file={file} maxHeight={140} />}
          </div>
        </div>
      )}
    </Modal>
  );
}
