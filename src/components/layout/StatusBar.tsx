import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { getHost } from '@/services/host';
import { cn, formatCount, formatStorage } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

/**
 * The status bar.
 *
 * Every desktop application that expects to be left open has one, for the same
 * reason: it is the place to say what the program is doing and how much of the
 * machine it is using, without ever asking for attention. Nothing here is a
 * control the user has to find — it is the bottom edge of the window, doing the
 * quiet half of the job the title bar does loudly.
 */
export function StatusBar() {
  const index = useArchiveStore((state) => state.index);
  const storage = useArchiveStore((state) => state.storage);
  const folders = useArchiveStore((state) => state.folders);
  const loading = useArchiveStore((state) => state.status === 'loading');
  const setIndexingOpen = useUIStore((state) => state.setIndexingOpen);

  const busy = index.state === 'indexing' || index.state === 'scanning';
  const queued = index.pending + index.processing;
  const problem = index.problem;
  const native = getHost().capabilities.sqlite;

  return (
    <footer className="glass relative z-30 flex h-7 shrink-0 items-center gap-3 border-t border-line px-3 text-2xs text-ink-3">
      {/* Left: what the pipeline is doing, which is the whole point of the bar. */}
      <button
        type="button"
        onClick={() => setIndexingOpen(true)}
        title="Indexing queue"
        className="flex min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 transition-colors duration-150 hover:bg-surface-3 hover:text-ink-2"
      >
        {loading ? (
          <>
            <Icon name="Loader2" size={11} className="animate-spin" />
            Opening the index…
          </>
        ) : problem ? (
          <>
            <Icon name="AlertTriangle" size={11} strokeWidth={2.2} className="text-caution" />
            <span className="truncate">{problem}</span>
          </>
        ) : busy ? (
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <span className="tabular-nums">
              {index.state === 'scanning' ? 'Scanning' : 'Indexing'} {formatCount(queued)}
            </span>
            {index.currentFile && (
              <span className="max-w-[280px] truncate font-mono text-ink-3/80">
                {index.currentFile}
              </span>
            )}
          </>
        ) : index.state === 'paused' ? (
          <>
            <Icon name="Pause" size={11} strokeWidth={2.2} className="text-caution" />
            <span className="tabular-nums">Paused · {formatCount(queued)} waiting</span>
          </>
        ) : (
          <>
            <Icon
              name="CheckCircle2"
              size={11}
              strokeWidth={2}
              className={storage.failedFiles > 0 ? 'text-caution' : 'text-positive'}
            />
            <span className="tabular-nums">
              {storage.failedFiles > 0
                ? `${formatCount(storage.failedFiles)} failed`
                : 'Index up to date'}
            </span>
          </>
        )}
      </button>

      <span className="h-3 w-px shrink-0 bg-line" aria-hidden="true" />

      <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
        <Icon name="Files" size={11} strokeWidth={2} />
        {formatCount(storage.indexedFiles)} files
      </span>

      <span className="hidden shrink-0 items-center gap-1.5 tabular-nums lg:flex">
        <Icon name="HardDrive" size={11} strokeWidth={2} />
        {formatStorage(storage.usedBytes)}
      </span>

      <span className="hidden shrink-0 items-center gap-1.5 tabular-nums lg:flex">
        <Icon name="Folder" size={11} strokeWidth={2} />
        {folders.length} {folders.length === 1 ? 'folder' : 'folders'}
      </span>

      <span className="flex-1" />

      {/* Right: the promise the product is built on, stated plainly. */}
      <span
        className={cn(
          'flex shrink-0 items-center gap-1.5',
          native ? 'text-ink-3' : 'text-caution',
        )}
        title={
          native
            ? 'Everything is indexed on this machine. Nothing is uploaded.'
            : 'Running without the desktop layer — nothing can be read or written.'
        }
      >
        <Icon name={native ? 'Shield' : 'Info'} size={11} strokeWidth={2.1} />
        {native ? 'Local · offline' : 'Browser preview'}
      </span>
    </footer>
  );
}
