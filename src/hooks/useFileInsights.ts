import { useEffect, useState } from 'react';
import type { SearchHit } from '@/types';
import { getHost } from '@/services/host';
import { useArchiveStore } from '@/stores/archive';

interface Insights {
  hits: SearchHit[];
  loading: boolean;
  error: string | null;
}

const EMPTY: Insights = { hits: [], loading: false, error: null };

/**
 * Related files, resolved by the retrieval layer rather than the renderer.
 *
 * Rust scores candidates on shared tags, shared text terms, the same folder, the
 * same project and how close they are in time — and, when embeddings exist,
 * visual similarity. The renderer only asks for them, which keeps one definition
 * of "related" for the inspector, the palette and anything added later.
 */
export function useRelatedFiles(fileId: string | null, limit = 3): Insights {
  const request = useAsyncInsight(fileId, limit, 'related');
  return request;
}

/** Visually similar files, by image embedding. Requires the local model. */
export function useSimilarFiles(fileId: string | null, limit = 12): Insights {
  return useAsyncInsight(fileId, limit, 'similar');
}

function useAsyncInsight(
  fileId: string | null,
  limit: number,
  kind: 'related' | 'similar',
): Insights {
  const [state, setState] = useState<Insights>(EMPTY);

  useEffect(() => {
    if (!fileId) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ hits: [], loading: true, error: null });

    const host = getHost();
    const call = kind === 'related' ? host.related(fileId, limit) : host.similar(fileId, limit);

    void call
      .then((hits) => {
        if (cancelled) return;
        if (hits.length > 0) {
          useArchiveStore.getState().remember(hits.map((hit) => hit.file));
        }
        setState({ hits, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          hits: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [fileId, limit, kind]);

  return state;
}
