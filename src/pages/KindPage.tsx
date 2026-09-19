import { useMemo, useState } from 'react';
import type { FileKind } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { KIND_EMPTY, KIND_LABEL, type SortKey } from '@/stores/selectors';
import { useRouteFiles } from '@/hooks/useRouteFiles';
import { formatBytes, pluralize } from '@/utils/format';
import { Page } from '@/components/common/Page';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { FileViews } from '@/components/files/FileViews';
import { SortMenu } from '@/components/files/SortMenu';

/**
 * Shared implementation for the kind routes (Photos, Screenshots, Documents,
 * Videos). They differ only in the filter and the copy, so they share a page
 * and keep their identity through the route — and the kind filter is applied by
 * the index, which is what keeps a folder of 40,000 screenshots from being read
 * into memory to display twelve tiles.
 */
export function KindPage({ kind, title }: { kind: FileKind; title: string }) {
  const [sort, setSort] = useState<SortKey>('recent');
  const result = useRouteFiles({ sort });

  const folders = useArchiveStore((state) => state.folders);
  const addFolder = useArchiveStore((state) => state.addFolder);

  const empty = KIND_EMPTY[kind];
  const bytes = useMemo(
    () => result.files.reduce((sum, file) => sum + file.bytes, 0),
    [result.files],
  );

  const subtitle = [
    KIND_LABEL[kind].toLowerCase(),
    pluralize(result.total, 'file'),
    formatBytes(bytes),
    folders.length === 0 ? 'no folders watched yet' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Page>
      <PageHeader title={title} subtitle={subtitle} count={result.total}>
        <SortMenu value={sort} onChange={setSort} />
        <Button variant="secondary" size="sm" icon="FolderOpen" onClick={() => void addFolder()}>
          Add folder
        </Button>
      </PageHeader>

      <FileViews
        result={result}
        kind={kind}
        emptyTitle={empty.title}
        emptyDescription={empty.detail}
      />
    </Page>
  );
}
