import { useEffect, useState } from 'react';
import type { FileKind } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import type { FileQueryResult } from '@/hooks/useFileQuery';
import { formatCount } from '@/utils/format';
import { Button } from '@/components/common/Button';
import { FileGrid } from './FileGrid';
import { FileList } from './FileList';
import { FileTimeline } from './FileTimeline';

/**
 * Renders the current view mode for a page of results.
 *
 * Every file route ends with this, which is what makes the grid / list /
 * timeline toggle in the top bar a global preference rather than a per-page
 * setting — and what makes paging behave the same everywhere, since the page's
 * query only ever holds one window of rows.
 */
export function FileViews({
  result,
  emptyTitle,
  emptyDescription,
  minColumn,
  /** Page's kind, which decides the icon and the fallback empty-state copy. */
  kind,
  onOpen,
}: {
  result: FileQueryResult;
  emptyTitle?: string;
  emptyDescription?: string;
  minColumn?: number;
  kind?: FileKind;
  onOpen?: (fileId: string) => void;
}) {
  const viewMode = useUIStore((state) => state.viewMode);
  const thumbnailSize = useSettingsStore((state) => state.thumbnailSize);
  const openFile = useArchiveStore((state) => state.openFile);
  const addFolder = useArchiveStore((state) => state.addFolder);
  const folders = useArchiveStore((state) => state.folders);

  const { files, total, loading, hasMore, loadMore } = result;
  const handleOpen = onOpen
    ? (file: (typeof files)[number]) => onOpen(file.id)
    : (file: (typeof files)[number]) => void openFile(file.id);

  const empty = (
    <div className="flex flex-col items-start gap-3">
      {folders.length === 0 && (
        <Button variant="primary" size="sm" icon="FolderPlus" onClick={() => void addFolder()}>
          Add a folder
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {viewMode === 'list' ? (
        <FileList files={files} loading={loading} onOpen={handleOpen} />
      ) : viewMode === 'timeline' ? (
        <FileTimeline files={files} loading={loading} onOpen={handleOpen} />
      ) : (
        <FileGrid
          files={files}
          loading={loading}
          minColumn={minColumn ?? thumbnailSize}
          onOpen={handleOpen}
          emptyTitle={emptyTitle ?? 'No files here'}
          emptyDescription={emptyDescription}
          emptyAction={folders.length === 0 ? empty : undefined}
          kind={kind}
        />
      )}

      {(hasMore || (loading && files.length > 0)) && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <Button
            variant="secondary"
            size="sm"
            icon="ArrowDown"
            loading={loading}
            onClick={loadMore}
          >
            Load more
          </Button>
          <span className="text-2xs tabular-nums text-ink-3">
            {formatCount(files.length)} of {formatCount(total)}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Keeps a route's query in step with the route.
 *
 * Declared here because every file page needs exactly this and nothing else:
 * run the query, and when the user switches tabs inside the page, keep the
 * selection from pointing at a file that is no longer on screen.
 */
export function useClearSelectionOnChange(key: string): void {
  const clearSelection = useUIStore((state) => state.clearSelection);
  const [last, setLast] = useState(key);

  useEffect(() => {
    if (last === key) return;
    setLast(key);
    clearSelection();
  }, [key, last, clearSelection]);
}
