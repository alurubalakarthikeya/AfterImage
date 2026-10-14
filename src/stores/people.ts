import { create } from 'zustand';
import type { ModelStatus, PeopleStats, Person } from '@/types';
import { report } from '@/boot';
import { getHost } from '@/services/host';
import { useUIStore } from './ui';

export type PeopleStatus = 'idle' | 'loading' | 'ready' | 'error';

const EMPTY_STATS: PeopleStats = { people: 0, faces: 0, unnamed: 0, photos: 0 };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function notice(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
  useUIStore.getState().pushNotice({ level, message });
}

export interface PeopleStoreState {
  status: PeopleStatus;
  error: string | null;
  people: Person[];
  stats: PeopleStats;
  /** False when the face models are not installed on this machine. */
  available: boolean;
  reason: string | null;
  /** What the model store holds. Null until it has been asked. */
  models: ModelStatus | null;
  /** A long-running request is in flight: scanning, rounding up, downloading. */
  busy: boolean;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  rename: (personId: string, label: string) => Promise<void>;
  merge: (fromId: string, intoId: string) => Promise<void>;
  /** Fold a whole selection into one group, in one operation. */
  mergeMany: (fromIds: string[], intoId: string) => Promise<void>;
  /** Take back the last merge. Answers whether there was one. */
  undoMerge: () => Promise<boolean>;
  hide: (personId: string) => Promise<void>;
  forget: (personId: string) => Promise<void>;
  regroup: () => Promise<void>;
  scan: () => Promise<void>;
  loadModels: () => Promise<void>;
  installModels: () => Promise<void>;
}

/**
 * People.
 *
 * Grouping is done by the index, on this machine; this store only holds the
 * result of asking it. A group is a suggestion of identity and the label is
 * whatever the user typed — so renaming is optimistic, because the click should
 * land instantly, and every regrouping waits for the backend, because the answer
 * genuinely changes when it finishes.
 */
export const usePeopleStore = create<PeopleStoreState>()((set, get) => {
  const patch = (next: Person) =>
    set((state) => ({
      people: state.people.map((person) => (person.id === next.id ? next : person)),
    }));

  return {
    status: 'idle',
    error: null,
    people: [],
    stats: EMPTY_STATS,
    available: false,
    reason: null,
    models: null,
    busy: false,

    async load() {
      const { status } = get();
      if (status === 'loading') return;
      set({ status: 'loading', error: null });
      try {
        const snapshot = await getHost().people();
        set({
          people: snapshot.people,
          stats: snapshot.stats,
          available: snapshot.available,
          reason: snapshot.reason ?? null,
          status: 'ready',
        });
      } catch (error) {
        // A failed read must not look like an empty archive: the page shows
        // this, and the log keeps it after the window is gone.
        report(`people: read failed — ${errorMessage(error)}`);
        set({ status: 'error', error: errorMessage(error) });
      }
    },

    async refresh() {
      try {
        const snapshot = await getHost().people();
        set({
          people: snapshot.people,
          stats: snapshot.stats,
          available: snapshot.available,
          reason: snapshot.reason ?? null,
          status: 'ready',
        });
      } catch (error) {
        notice('error', `Could not read the people in this archive: ${errorMessage(error)}`);
      }
    },

    async rename(personId, label) {
      const person = get().people.find((item) => item.id === personId);
      if (!person) return;
      const clean = label.trim();
      // Optimistic: the name is the user's own word, and it should appear as
      // soon as they press Enter rather than after a database round trip.
      patch({ ...person, label: clean || undefined });
      try {
        await getHost().renamePerson(personId, clean || null);
        await get().refresh();
      } catch (error) {
        patch(person);
        notice('error', errorMessage(error));
      }
    },

    async merge(fromId, intoId) {
      const from = get().people.find((item) => item.id === fromId);
      const into = get().people.find((item) => item.id === intoId);
      set({ busy: true });
      try {
        await getHost().mergePeople(fromId, intoId);
        notice(
          'success',
          `Merged ${into?.label ?? 'that group'} and ${from?.label ?? 'the other group'}`,
        );
        await get().refresh();
        // Whoever was on screen no longer exists after a merge.
        const ui = useUIStore.getState();
        if (ui.activePersonId === fromId) ui.openPerson(intoId);
      } catch (error) {
        notice('error', errorMessage(error));
      } finally {
        set({ busy: false });
      }
    },

    async mergeMany(fromIds, intoId) {
      set({ busy: true });
      try {
        await getHost().mergePeopleMany(fromIds, intoId);
        const survivor = get().people.find((item) => item.id === intoId);
        await get().refresh();
        // The action is the whole reason a merge is safe to offer: the notice
        // carries the way back for as long as it is on screen, and the record
        // behind it lives in the archive rather than in this component.
        useUIStore.getState().pushNotice({
          level: 'success',
          message: `Merged ${fromIds.length} groups into ${survivor?.label ?? 'one group'}`,
          action: {
            label: 'Undo',
            run: () => void get().undoMerge(),
          },
        });
      } catch (error) {
        notice('error', errorMessage(error));
      } finally {
        set({ busy: false });
      }
    },

    async undoMerge() {
      set({ busy: true });
      try {
        const undone = await getHost().undoPeopleMerge();
        if (!undone) {
          notice('info', 'There was no merge to undo');
          return false;
        }
        await get().refresh();
        notice('success', 'Merge undone — the groups are separate again');
        return true;
      } catch (error) {
        notice('error', errorMessage(error));
        return false;
      } finally {
        set({ busy: false });
      }
    },

    async hide(personId) {
      set({ busy: true });
      try {
        await getHost().setPersonHidden(personId, true);
        notice('info', 'Hidden — the photographs themselves are untouched');
        await get().refresh();
        const ui = useUIStore.getState();
        if (ui.activePersonId === personId) ui.navigate('people');
      } catch (error) {
        notice('error', errorMessage(error));
      } finally {
        set({ busy: false });
      }
    },

    /**
     * Delete a group outright.
     *
     * Hiding keeps a bad cluster out of the way but it comes back on the next
     * regroup; this is for the faces that were never a person, and it is
     * deliberately permanent — see `people::forget` on the backend.
     */
    async forget(personId) {
      set({ busy: true });
      try {
        const faces = await getHost().forgetPerson(personId);
        notice(
          'success',
          `Deleted that group and the ${faces} ${faces === 1 ? 'face' : 'faces'} in it — your photographs are untouched`,
        );
        await get().refresh();
        const ui = useUIStore.getState();
        if (ui.activePersonId === personId) ui.navigate('people');
      } catch (error) {
        notice('error', errorMessage(error));
      } finally {
        set({ busy: false });
      }
    },

    async regroup() {
      set({ busy: true });
      try {
        const groups = await getHost().regroupPeople();
        await get().refresh();
        notice('success', `Regrouped into ${groups} ${groups === 1 ? 'person' : 'people'}`);
      } catch (error) {
        notice('error', errorMessage(error));
      } finally {
        set({ busy: false });
      }
    },

    async scan() {
      set({ busy: true });
      try {
        const count = await getHost().scanFaces();
        if (count === 0) {
          notice('info', 'Every photograph has already been looked at');
        } else {
          notice('info', `Looking for faces in ${count} ${count === 1 ? 'photo' : 'photos'}`);
        }
      } catch (error) {
        notice('error', errorMessage(error));
      } finally {
        set({ busy: false });
      }
    },

    async loadModels() {
      try {
        const models = await getHost().modelStatus();
        set({ models });
      } catch (error) {
        report(`people: model status failed — ${errorMessage(error)}`);
        set({
          models: {
            bundles: [],
            available: false,
            missingMegabytes: 0,
            reason: errorMessage(error),
            canStart: false,
            onBattery: false,
          },
        });
      }
    },

    async installModels() {
      set({ busy: true });
      try {
        await getHost().installModels(['faces']);
        // The command starts the local service first when it is not running, so
        // the note says what will happen rather than promising a download that
        // has nowhere to go.
        notice('info', 'Fetching the face models — this continues in the background');
        // The download runs on its own thread, so the status is re-read rather
        // than awaited: nothing here should hold the interface for a minute.
        window.setTimeout(() => {
          void get().loadModels();
          void get().refresh();
        }, 4000);
      } catch (error) {
        notice('error', errorMessage(error));
      } finally {
        set({ busy: false });
      }
    },
  };
});
