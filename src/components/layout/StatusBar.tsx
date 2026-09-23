import { useArchiveStore } from '@/stores/archive';
import { usePeopleStore } from '@/stores/people';
import { useUIStore } from '@/stores/ui';
import { getHost } from '@/services/host';
import { cn, formatCount, formatRelativeTime, formatStorage } from '@/utils/format';
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
  const tags = useArchiveStore((state) => state.tags);
  const collections = useArchiveStore((state) => state.collections);
  const peopleStats = usePeopleStore((state) => state.stats);
  const loading = useArchiveStore((state) => state.status === 'loading');
  const setIndexingOpen = useUIStore((state) => state.setIndexingOpen);
  const navigate = useUIStore((state) => state.navigate);

  const busy = index.state === 'indexing' || index.state === 'scanning';
  const queued = index.pending + index.processing;
  const problem = index.problem;
  const native = getHost().capabilities.sqlite;

  // Averaged over this run, which is the only rate the pipeline can honestly
  // report: it counts finished files against the wall clock of the batch.
  const rate = index.perMinute > 0 ? `${formatCount(index.perMinute)}/min` : null;

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

      {/* The rate, and only while there is a rate to report. It is the one
          number here that answers "how long will this take", which nothing else
          on screen does — the queue shows how much is left, not how fast. */}
      {busy && rate && (
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-ink-2">
          <Icon name="Gauge" size={11} strokeWidth={2} />
          {rate}
        </span>
      )}

      {/* The folder being walked, which is the useful half of "scanning" — the
          filename is already in the left-hand segment. */}
      {busy && index.currentFolder && (
        <span className="hidden min-w-0 shrink-0 items-center gap-1.5 lg:flex">
          <span className="max-w-[240px] truncate font-mono text-ink-3/80">
            {index.currentFolder}
          </span>
        </span>
      )}

      {/* What the archive is made of, counted once and never repeated in the
          sidebar or the inspector: tags and collections are user-made structure,
          and people exist only when the face models have been installed. */}
      {tags.length > 0 && (
        <button
          type="button"
          onClick={() => navigate('home')}
          title="Tags in use"
          className="hidden shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 tabular-nums transition-colors duration-150 hover:bg-surface-3 hover:text-ink-2 md:flex"
        >
          <Icon name="Tag" size={11} strokeWidth={2} />
          {formatCount(tags.length)} tags
        </button>
      )}

      {collections.length > 0 && (
        <button
          type="button"
          onClick={() => navigate('collections')}
          title="Collections"
          className="hidden shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 tabular-nums transition-colors duration-150 hover:bg-surface-3 hover:text-ink-2 md:flex"
        >
          <Icon name="Layers" size={11} strokeWidth={2} />
          {formatCount(collections.length)} collections
        </button>
      )}

      {peopleStats.people > 0 && (
        <button
          type="button"
          onClick={() => navigate('people')}
          title={
            peopleStats.unnamed > 0
              ? `${peopleStats.unnamed} groups still to name`
              : 'Every group is named'
          }
          className="hidden shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 tabular-nums transition-colors duration-150 hover:bg-surface-3 hover:text-ink-2 md:flex"
        >
          <Icon name="Users" size={11} strokeWidth={2} />
          {formatCount(peopleStats.people)} people
          {peopleStats.unnamed > 0 && (
            <span className="text-caution">{formatCount(peopleStats.unnamed)} to name</span>
          )}
        </button>
      )}

      <span className="flex-1" />

      {/* When the index was last brought level with disk. The inspector shows a
          full timestamp; this is the glanceable version, and it is the one fact
          a person checks before deciding to rescan. */}
      {index.lastScanAt && !busy && (
        <span className="hidden shrink-0 items-center gap-1.5 lg:flex">
          <Icon name="Clock" size={11} strokeWidth={2} />
          Indexed {formatRelativeTime(index.lastScanAt)}
        </span>
      )}

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
