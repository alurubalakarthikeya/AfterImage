import { useMemo } from 'react';
import { useUIStore } from '@/stores/ui';
import { routeFileQuery, type SortKey } from '@/stores/selectors';
import { useFileQuery, type FileQueryResult } from './useFileQuery';

/**
 * The files the current route is showing.
 *
 * The route decides the query, the index answers it, and pages, quick look and
 * the inspector's neighbours all read the same result — so keyboard navigation
 * always matches what is on screen.
 */
export function useRouteFiles(options: { sort?: SortKey } = {}): FileQueryResult {
  const route = useUIStore((state) => state.route);
  const collectionId = useUIStore((state) => state.activeCollectionId);
  const projectId = useUIStore((state) => state.activeProjectId);
  const day = useUIStore((state) => state.activeDay);
  const sort = options.sort ?? 'recent';

  const query = useMemo(
    () => routeFileQuery(route, { collectionId, projectId, sort, day }),
    [route, collectionId, projectId, sort, day],
  );

  return useFileQuery(query);
}
