import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileVersion } from '@/types';
import { getHost } from '@/services/host';
import { useUIStore } from '@/stores/ui';

export interface FileVersionsResult {
  /** Newest content first, exactly as the index returns them. */
  versions: FileVersion[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Keeps the state the file is in right now. Returns the new version. */
  capture: () => Promise<FileVersion | null>;
  remove: (versionId: string) => Promise<void>;
}

/**
 * A file's kept versions.
 *
 * The comparison view needs two things to compare, and only one of them can
 * come from history: whatever the archive saved before the last edit is the
 * "before", and the state on disk now is the "after". The second is kept the
 * first time it is asked for, which is what `ensureCurrent` is for — a version
 * is a file on disk, so asking the webview to load the live presentation copy
 * twice under the same URL would show the cached old one and quietly compare a
 * picture with itself.
 */
export function useFileVersions(fileId: string | null): FileVersionsResult {
  const pushNotice = useUIStore((state) => state.pushNotice);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<FileVersion[]> => {
    if (!fileId) return [];
    try {
      const list = await getHost().versions(fileId);
      if (mounted.current) setVersions(list);
      return list;
    } catch (cause) {
      if (mounted.current) setVersions([]);
      pushNotice({
        level: 'warn',
        message: `Could not read this file's versions: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      });
      return [];
    }
  }, [fileId, pushNotice]);

  const refresh = useCallback(async () => {
    if (!fileId) {
      setVersions([]);
      return;
    }
    setLoading(true);
    await load();
    if (mounted.current) setLoading(false);
  }, [fileId, load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const capture = useCallback(async (): Promise<FileVersion | null> => {
    if (!fileId) return null;
    try {
      const version = await getHost().captureVersion(fileId);
      await load();
      return version;
    } catch (cause) {
      pushNotice({
        level: 'warn',
        message: `Could not keep this version: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      });
      return null;
    }
  }, [fileId, load, pushNotice]);

  const remove = useCallback(
    async (versionId: string) => {
      try {
        await getHost().deleteVersion(versionId);
        await load();
      } catch (cause) {
        pushNotice({
          level: 'error',
          message: `Could not remove that version: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        });
      }
    },
    [load, pushNotice],
  );

  return { versions, loading, refresh, capture, remove };
}
