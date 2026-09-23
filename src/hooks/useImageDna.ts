import { useEffect, useState } from 'react';
import type { ImageDna } from '@/types';
import { getHost } from '@/services/host';

/**
 * Measured picture data.
 *
 * One decode per file revision, per session: the answer is a property of the
 * pixels on disk, and the backend already holds its own copy, so the renderer's
 * job is only to not ask twice. The cache is keyed on the file's modification
 * time as well as its id, which is what makes an edit in another application
 * produce a fresh measurement instead of the old one.
 */
const cache = new Map<string, ImageDna>();

export interface ImageDnaResult {
  dna: ImageDna | null;
  loading: boolean;
  /** Why there is nothing to show, when there is nothing to show. */
  error: string | null;
}

export function useImageDna(
  fileId: string | null,
  modifiedAt: string | null,
): ImageDnaResult {
  const key = fileId && modifiedAt ? `${fileId}@${modifiedAt}` : null;
  const [dna, setDna] = useState<ImageDna | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId || !key) {
      setDna(null);
      setError(null);
      setLoading(false);
      return;
    }

    const cached = cache.get(key);
    if (cached) {
      setDna(cached);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void getHost()
      .imageDna(fileId)
      .then((value) => {
        if (cancelled) return;
        cache.set(key, value);
        setDna(value);
      })
      .catch((cause) => {
        if (cancelled) return;
        setDna(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fileId, key]);

  return { dna, loading, error };
}
