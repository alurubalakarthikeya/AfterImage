import { useEffect } from 'react';
import { getHost, isTauri } from '@/services/host';
import { useArchiveStore } from '@/stores/archive';
import { usePeopleStore } from '@/stores/people';
import { useSettingsStore } from '@/stores/settings';
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

    // The same preferences live in two places: this store, which is what the
    // interface reads, and the archive's own database, which is what the
    // watcher and the pipeline read — neither of those ever sees the renderer.
    // They can only agree if one is pushed when a session opens, so the
    // persisted values go across once here. The push is idempotent and every
    // field is optional, so a backend that has never heard of one ignores it.
    const stored = useSettingsStore.getState();
    void host
      .updatePreferences({
        semanticSearch: stored.semanticSearch,
        servicePort: stored.servicePort,
        localProcessing: stored.localProcessing,
        autoIndex: stored.autoIndex,
        indexOnBattery: stored.indexOnBattery,
        llmEnabled: stored.llmEnabled,
        llmModel: stored.llmModel,
        vlmEnabled: stored.vlmEnabled,
        vlmModel: stored.vlmModel,
      })
      .catch(() => undefined);

    // The models are fetched without being asked for.
    //
    // They are what makes the archive more than a file list — visual labels,
    // descriptions and faces — and they are a two-hundred-megabyte download
    // nobody would find behind a settings row. So once a session has settled
    // (folders granted, queue empty) the missing bundles are fetched in the
    // background, and the pipeline reopens the already-indexed files by itself
    // when they land, so tags and people appear without another gesture. Once
    // per session, and never in the browser build, which has no service to
    // download into and says so instead of pretending.
    let askedForModels = false;
    const ensureModels = async () => {
      if (askedForModels || !isTauri()) return;
      if (useArchiveStore.getState().folders.length === 0) return;
      const models = await host.modelStatus().catch(() => null);
      if (!models?.available) return;
      const wanted = models.bundles
        .filter((bundle) => !bundle.ready)
        .map((bundle) => bundle.name)
        .filter((name) => name === 'vision' || name === 'text' || name === 'faces');
      if (wanted.length === 0) return;
      askedForModels = true;
      useUIStore.getState().pushNotice({
        level: 'info',
        message: `Fetching the local models (${Math.round(
          models.missingMegabytes,
        )} MB) — tags, descriptions and faces come on when they arrive.`,
      });
      await host.installModels(wanted).catch(() => undefined);
    };

    // A finished run is the one thing this application is worth interrupting
    // somebody for, so it is the only thing that raises a desktop notification.
    // "Finished" is measured against the previous status rather than guessed
    // from a single event: a scan of four thousand files reports `indexing`
    // many times and `idle` once, and only the last one is an ending.
    let wasBusy = false;

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
          const status = event.status;
          const busy = status.pending + status.processing > 0 || status.state === 'scanning';
          if (
            wasBusy &&
            !busy &&
            status.done > 0 &&
            useSettingsStore.getState().notifications
          ) {
            void host.notify(
              'Indexing finished',
              `${status.done} ${status.done === 1 ? 'file' : 'files'} indexed${
                status.failed > 0 ? `, ${status.failed} could not be read` : ''
              }.`,
            );
          }
          wasBusy = busy;

          useArchiveStore.setState({ index: status });
          if (status.state === 'idle' || status.state === 'error') {
            scheduleRefresh(400);
            // The service has had time to answer by the time a queue drains,
            // which is when the model store can be read honestly.
            void ensureModels();
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

    // And a session that opens on a settled archive (nothing was added, so no
    // queue will ever drain) still gets its models.
    const modelTimer = window.setTimeout(() => void ensureModels(), 3000);

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      window.clearTimeout(modelTimer);
      unsubscribe();
    };
  }, []);
}
