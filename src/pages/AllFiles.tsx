import { useMemo, useState } from 'react';
import { useArchiveStore } from '@/stores/archive';
import { useCollectionStore } from '@/stores/collections';
import { useUIStore } from '@/stores/ui';
import type { SortKey } from '@/stores/selectors';
import { useRouteFiles } from '@/hooks/useRouteFiles';
import { formatBytes, pluralize } from '@/utils/format';
import { Page } from '@/components/common/Page';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { FileViews } from '@/components/files/FileViews';
import { SortMenu } from '@/components/files/SortMenu';

/**
 * All files.
 *
 * The three view modes the spec asks for — grid, list, timeline — are switched
 * from the toolbar so the choice carries across every page. The rows come from
 * the index one page at a time, so this page is honest about a 200,000-file
 * archive on a laptop: it reads 120 rows, then reads more when asked.
 */
export function AllFiles() {
  const [sort, setSort] = useState<SortKey>('recent');
  const result = useRouteFiles({ sort });

  const folders = useArchiveStore((state) => state.folders);
  const storage = useArchiveStore((state) => state.storage);
  const addFolder = useArchiveStore((state) => state.addFolder);
  const selectMany = useUIStore((state) => state.selectMany);
  const selectedIds = useUIStore((state) => state.selectedFileIds);
  const beginDraft = useCollectionStore((state) => state.beginDraft);

  const watchedCount = folders.filter((folder) => folder.watched).length;
  const allSelected = result.files.length > 0 && selectedIds.length === result.files.length;

  const subtitle = useMemo(() => {
    const parts = [pluralize(result.total, 'file'), formatBytes(storage.usedBytes)];
    parts.push(
      watchedCount === 0
        ? 'no folders watched yet'
        : `${pluralize(watchedCount, 'watched folder')}`,
    );
    return parts.join(' · ');
  }, [result.total, storage.usedBytes, watchedCount]);

  return (
    <Page>
      <PageHeader title="All Files" subtitle={subtitle} count={result.total}>
        <button
          type="button"
          disabled={result.files.length === 0}
          onClick={() => selectMany(allSelected ? [] : result.files.map((file) => file.id))}
          className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-meta text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name="Check" size={13} strokeWidth={2} />
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
        <SortMenu value={sort} onChange={setSort} />
        <Button variant="secondary" size="sm" icon="FolderPlus" onClick={beginDraft}>
          Collection
        </Button>
        <Button variant="secondary" size="sm" icon="FolderOpen" onClick={() => void addFolder()}>
          Add folder
        </Button>
      </PageHeader>

      <FileViews
        result={result}
        emptyTitle="The archive is empty"
        emptyDescription="Choose a folder and AfterImage will index everything inside it — no importing, no renaming."
      />
    </Page>
  );
}
