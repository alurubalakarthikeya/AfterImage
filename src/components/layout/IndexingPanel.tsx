import { useEffect, useRef } from 'react';
import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { cn, formatBytes, formatCount, formatRelativeTime } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { Button } from '@/components/common/Button';
import { ProgressBar } from '@/components/common/ProgressBar';

/**
 * The indexing panel.
 *
 * What the status line opens: which folder is being read, how far along the
 * queue is, which files failed and why, and the two controls that matter —
 * pause and resume. Everything here is reported by the pipeline; nothing is
 * estimated in the renderer.
 */
export function IndexingPanel() {
  const open = useUIStore((state) => state.indexingOpen);
  const setOpen = useUIStore((state) => state.setIndexingOpen);
  const index = useArchiveStore((state) => state.index);
  const storage = useArchiveStore((state) => state.storage);
  const folders = useArchiveStore((state) => state.folders);
  const pause = useArchiveStore((state) => state.pauseIndexing);
  const resume = useArchiveStore((state) => state.resumeIndexing);
  const clearFailures = useArchiveStore((state) => state.clearFailures);
  const rescanFolder = useArchiveStore((state) => state.rescanFolder);
  const removeFolder = useArchiveStore((state) => state.removeFolder);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('[data-index-trigger]')) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  if (!open) return null;

  const busy = index.state === 'indexing' || index.state === 'scanning';
  const finished = Math.max(0, index.total - index.pending - index.processing);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Indexing"
      className="glass-float af-fade-in fixed left-4 top-[60px] z-[70] w-[380px] rounded-card border border-line p-4"
      style={{ boxShadow: 'var(--af-shadow-float)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-card font-semibold text-ink">Indexing</h2>
          <p className="mt-0.5 text-2xs text-ink-3">
            {index.lastScanAt
              ? `Last scan ${formatRelativeTime(index.lastScanAt)}`
              : 'No scan has run yet'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
        >
          <Icon name="X" size={14} strokeWidth={2} />
        </button>
      </div>

      {index.problem && (
        <p className="mt-3 rounded-panel border border-caution/30 bg-caution/10 px-3 py-2 text-2xs leading-relaxed text-ink-2">
          {index.problem}
        </p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric label="Indexed" value={formatCount(storage.indexedFiles)} />
        <Metric label="Waiting" value={formatCount(index.pending + index.processing)} />
        <Metric label="Failed" value={formatCount(index.failed)} tone={index.failed > 0 ? 'warn' : undefined} />
      </div>

      {index.total > 0 && (
        <div className="mt-3">
          <ProgressBar value={finished} max={index.total} height={4} />
          <div className="mt-1.5 flex items-center justify-between text-2xs text-ink-3">
            <span className="tabular-nums">
              {formatCount(finished)} of {formatCount(index.total)} processed
            </span>
            {busy && index.perMinute > 0 && (
              <span className="tabular-nums">{formatCount(index.perMinute)} files/min</span>
            )}
          </div>
        </div>
      )}

      {index.currentFile && (
        <div className="mt-3 flex items-center gap-2 rounded-panel bg-surface-2 px-2.5 py-2">
          <Icon name={busy ? 'Loader2' : 'File'} size={13} className={busy ? 'animate-spin text-accent' : 'text-ink-3'} />
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-2">
            {index.currentFile}
          </span>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {index.state === 'paused' ? (
          <Button variant="primary" size="sm" icon="Play" className="flex-1 justify-center" onClick={() => void resume()}>
            Resume
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon="Pause"
            className="flex-1 justify-center"
            onClick={() => void pause()}
            disabled={!busy && index.pending === 0}
          >
            Pause
          </Button>
        )}
        {index.failed > 0 && (
          <Button variant="ghost" size="sm" icon="RefreshCw" onClick={() => void clearFailures()}>
            Retry failed
          </Button>
        )}
      </div>

      {folders.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
            Watched folders
          </div>
          <div className="mt-2 flex max-h-[190px] flex-col gap-1 overflow-y-auto pr-1">
            {folders.map((folder) => (
              <div key={folder.id} className="group/folder flex items-center gap-2 rounded-[10px] px-2 py-1.5 hover:bg-surface-2">
                <Icon
                  name={folder.status === 'ok' ? 'Folder' : 'AlertTriangle'}
                  size={13}
                  strokeWidth={1.9}
                  className={cn('shrink-0', folder.status === 'ok' ? 'text-ink-3' : 'text-caution')}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-2xs text-ink-2" title={folder.path}>
                    {folder.path}
                  </span>
                  <span className="block text-[10px] text-ink-3">
                    {formatCount(folder.fileCount)} files · {formatBytes(folder.sizeBytes)}
                    {folder.problem ? ` · ${folder.problem}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/folder:opacity-100">
                  <IconAction
                    icon="RefreshCw"
                    label="Rescan"
                    onClick={() => void rescanFolder(folder.id)}
                  />
                  <IconAction
                    icon="X"
                    label="Stop watching"
                    onClick={() => void removeFolder(folder.id)}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-panel bg-surface-2 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.06em] text-ink-3">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-[15px] font-semibold tabular-nums',
          tone === 'warn' ? 'text-caution' : 'text-ink',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function IconAction({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
    >
      <Icon name={icon} size={12} strokeWidth={2} />
    </button>
  );
}
