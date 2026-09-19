import { useEffect } from 'react';
import { getHost } from '@/services/host';
import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';

/**
 * The only subscription to the host's event stream.
 *
 * Rust reports pipeline progress and filesystem changes here; the UI decides how
 * loudly to say so. Indexing is intentionally quiet — a status line and a
 * sidebar counter, never a blocking spinner — but the counts behind it are
 * always re-read from the database rather than adjusted in the renderer, so the
 * numbers on screen are the numbers in the index.
 */
export function useHostBridge(): void {
  useEffect(() => {
    const host = getHost();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    /** Coalesces bursts: a scan of 4,000 files emits many change events. */
    const scheduleRefresh = (delay = 600) => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void useArchiveStore.getState().refresh();
      }, delay);
    };

    const unsubscribe = host.subscribe((event) => {
      const ui = useUIStore.getState();

      switch (event.type) {
        case 'index-status': {
          useArchiveStore.setState({ index: event.status });
          if (event.status.state === 'idle' || event.status.state === 'error') {
            scheduleRefresh(400);
          }
          return;
        }
        case 'files-changed': {
          if (event.reason === 'watch') {
            ui.pushNotice({
              level: 'info',
              message: 'New files detected in a watched folder — indexing in the background.',
            });
          }
          scheduleRefresh();
          return;
        }
        case 'folders-changed': {
          scheduleRefresh(200);
          return;
        }
        case 'notice': {
          ui.pushNotice({ level: event.level, message: event.message });
          return;
        }
        default:
          return;
      }
    });

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, []);
}
