import { useEffect } from 'react';
import { getHost } from '@/services/host';
import { useArchiveStore } from '@/stores/archive';
import { usePeopleStore } from '@/stores/people';
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

        // People ride along on the same events. Two things make this necessary
        // rather than tidy: groups are *created* by indexing, so the count in
        // the sidebar changes while nobody is looking at that page; and the
        // indexing service takes a few seconds to start, so the first read of
        // the model store can honestly answer "not installed" on a cold launch
        // and would otherwise stay wrong until the app was restarted.
        const people = usePeopleStore.getState();
        if (people.status !== 'idle') void people.refresh();
        if (!people.models?.available) void people.loadModels();
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
        case 'models-changed': {
          // What this machine can now do has changed, so the capability answers
          // are re-read rather than assumed.
          void usePeopleStore.getState().loadModels();
          void usePeopleStore.getState().refresh();
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

    // The sidebar shows how many people the archive holds, so the groups are
    // read once the archive is open — not only when the People page is visited.
    void usePeopleStore.getState().load();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, []);
}
