import { useEffect, useMemo, useRef } from 'react';
import type { ArchiveFile } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import type { FileQuery } from '@/services/host';

export interface FileQueryResult {
  files: ArchiveFile[];
  /** Rows the query matched in the index, which may exceed `files`. */
  total: number;
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Loads a page of files for a query.
 *
 * Queries are run by the index, not by the renderer, so this hook's whole job is
 * to keep the request stable (the object identity changes on every render, the
 * query key does not) and to hand back paging controls.
 */
export function useFileQuery(query: FileQuery | null): FileQueryResult {
  const loadFiles = useArchiveStore((state) => state.loadFiles);
  const loadMore = useArchiveStore((state) => state.loadMore);
  const files = useArchiveStore((state) => state.files);
  const total = useArchiveStore((state) => state.total);
  const loading = useArchiveStore((state) => state.loading);
  const hasMore = useArchiveStore((state) => state.hasMore);

  const key = useMemo(() => (query ? JSON.stringify(query) : null), [query]);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!key) return;
    if (lastKey.current === key && files.length > 0) return;
    lastKey.current = key;
    void loadFiles(JSON.parse(key) as FileQuery);
    // `files` intentionally not a dependency: it changes on every page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadFiles]);

  return {
    files: query ? files : [],
    total: query ? total : 0,
    loading: query ? loading : false,
    hasMore: query ? hasMore : false,
    loadMore: () => void loadMore(),
  };
}
