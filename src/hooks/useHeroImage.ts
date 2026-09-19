import { useCallback, useEffect, useState } from 'react';
import type { ArchiveFile } from '@/types';
import { getHost } from '@/services/host';
import { useArchiveStore } from '@/stores/archive';

/**
 * The photograph the Home hero is built from.
 *
 * It comes out of the user's own index — Rust picks the best landscape
 * photograph that has already been through the pipeline and hands back its
 * preview path. When the archive holds nothing suitable the answer is `null`,
 * and the hero renders its own tint instead. There is no bundled picture and no
 * remote URL anywhere in this path.
 *
 * The read is repeated whenever the queue changes state, because the moment
 * indexing settles is the moment a newly added photograph has a preview on disk.
 */
export function useHeroImage(): ArchiveFile | null {
  const [hero, setHero] = useState<ArchiveFile | null>(null);
  const status = useArchiveStore((state) => state.status);
  const indexState = useArchiveStore((state) => state.index.state);
  const totalFiles = useArchiveStore((state) => state.totals.files);

  const reload = useCallback(() => {
    let cancelled = false;
    getHost()
      .heroImage()
      .then((file) => {
        if (!cancelled) setHero(file);
      })
      .catch(() => {
        // A host without an index simply has no photograph to offer.
        if (!cancelled) setHero(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => reload(),
    // `totalFiles` catches the first scan, `indexState` every later one.
    [reload, status, indexState, totalFiles],
  );

  return hero;
}
