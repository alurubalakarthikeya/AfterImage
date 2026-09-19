import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { formatCount } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

/**
 * Indexing status.
 *
 * One line, in the quiet strip left of the search field, and it is a button:
 * clicking opens the queue. The rule from the spec stands — never make the user
 * watch a spinner per file — but the numbers here are the pipeline's own.
 */
export function IndexStatus() {
  const index = useArchiveStore((state) => state.index);
  const storage = useArchiveStore((state) => state.storage);
  const folders = useArchiveStore((state) => state.folders);
  const loading = useArchiveStore((state) => state.status === 'loading');
  const setIndexingOpen = useUIStore((state) => state.setIndexingOpen);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-2 text-meta text-ink-3">
        <Icon name="Loader2" size={14} className="animate-spin" />
        Opening the index…
      </span>
    );
  }

  if (folders.length === 0) {
    return (
      <span className="inline-flex items-center gap-2 text-meta text-ink-3">
        <Icon name="FolderPlus" size={14} strokeWidth={1.9} />
        No folders watched
      </span>
    );
  }

  const busy = index.state === 'indexing' || index.state === 'scanning';
  const queued = index.pending + index.processing;

  return (
    <button
      type="button"
      onClick={() => setIndexingOpen(true)}
      className="inline-flex items-center gap-2 rounded-[10px] px-2 py-1 text-meta transition-colors duration-150 hover:bg-surface-3"
      title="Indexing queue"
    >
      {busy ? (
        <>
          {/* A steady dot rather than a pulsing one: the count beside it is the
              progress indicator, and it moves. */}
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          <span className="tabular-nums text-ink-2">
            {index.state === 'scanning'
              ? 'Scanning folders…'
              : `Indexing ${formatCount(queued)} file${queued === 1 ? '' : 's'}`}
          </span>
          {index.currentFile && (
            <span className="max-w-[220px] truncate text-ink-3">{index.currentFile}</span>
          )}
        </>
      ) : index.state === 'paused' ? (
        <>
          <Icon name="Pause" size={13} strokeWidth={2} className="text-caution" />
          <span className="text-ink-2">
            Paused · {formatCount(queued)} waiting
          </span>
        </>
      ) : index.state === 'error' ? (
        <>
          <Icon name="AlertTriangle" size={13} strokeWidth={2} className="text-critical" />
          <span className="text-ink-2">Indexing stopped</span>
        </>
      ) : (
        <>
          <Icon
            name="CheckCircle2"
            size={13}
            strokeWidth={1.9}
            className={storage.failedFiles > 0 ? 'text-caution' : 'text-positive/80'}
          />
          <span className="tabular-nums text-ink-2">
            {formatCount(storage.indexedFiles)} indexed ·{' '}
            {storage.failedFiles > 0
              ? `${formatCount(storage.failedFiles)} failed`
              : queued > 0
                ? `${formatCount(queued)} queued`
                : 'up to date'}
          </span>
        </>
      )}
    </button>
  );
}
