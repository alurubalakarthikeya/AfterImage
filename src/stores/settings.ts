import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import type { Appearance, Density } from '@/types';
import { getHost } from '@/services/host';
import { clearCookie, readCookie, writeCookie } from '@/utils/cookies';

/**
 * Preferences, remembered twice.
 *
 * `localStorage` is the primary copy — it is synchronous, which is what lets
 * index.html paint in the right theme before React loads. A cookie is written
 * alongside it on every change and read only when `localStorage` has nothing,
 * which is what makes the application remember you after a browser evicts site
 * data, on a fresh private session, or between two machines on the same
 * profile. It is a fallback, never a second authority: whichever store already
 * has an entry for this user wins, so the two cannot fight.
 */
/**
 * The fields that are persisted.
 *
 * Declared as a named function rather than an inline literal for one reason:
 * it gives the storage layer the *exact* type to read and write. The setters
 * and derived fields are deliberately not here — a preference is a value, not
 * an action, and replaying an action from disk would be nonsense.
 */
function persistable(state: SettingsState) {
  return {
    appearance: state.appearance,
    density: state.density,
    reduceTransparency: state.reduceTransparency,
    showThumbnailMeta: state.showThumbnailMeta,
    thumbnailSize: state.thumbnailSize,
    localProcessing: state.localProcessing,
    autoIndex: state.autoIndex,
    indexOnBattery: state.indexOnBattery,
    notifications: state.notifications,
    semanticSearch: state.semanticSearch,
    llmEnabled: state.llmEnabled,
    llmModel: state.llmModel,
    servicePort: state.servicePort,
    userName: state.userName,
    accountLabel: state.accountLabel,
    useCases: state.useCases,
    onboarded: state.onboarded,
    lastBackupAt: state.lastBackupAt,
  };
}

type PersistedSettings = ReturnType<typeof persistable>;

const cookieBackedStorage: PersistStorage<PersistedSettings> = {
  getItem(name) {
    let raw: string | null = null;
    try {
      raw = globalThis.localStorage?.getItem(name) ?? null;
    } catch {
      // Storage can be denied outright (policy, private mode). The cookie is
      // why there is still a preference to restore.
      raw = null;
    }
    raw = raw ?? readCookie(name);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { state?: PersistedSettings; version?: number };
      if (parsed && typeof parsed === 'object' && parsed.state && 'state' in parsed) {
        return { state: parsed.state, version: parsed.version ?? 1 };
      }
      // A bare object is an older shape; treat it as the state itself.
      const bare = parsed as PersistedSettings | null;
      if (!bare || typeof bare !== 'object') return null;
      return { state: bare, version: 1 };
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    try {
      globalThis.localStorage?.setItem(name, raw);
    } catch {
      // Quota or a denied origin. The cookie below still holds the value.
    }
    writeCookie(name, raw);
  },
  removeItem(name) {
    try {
      globalThis.localStorage?.removeItem(name);
    } catch {
      /* nothing to remove from a store we cannot reach */
    }
    clearCookie(name);
  },
};

/**
 * User preferences. Persisted locally, never synced anywhere.
 *
 * Defaults are chosen so a first launch looks like the thing in the spec:
 * light appearance, comfortable density, semantic search off until the user
 * opts into the local model.
 */
export interface SettingsState {
  appearance: Appearance;
  density: Density;
  /** Flatten the floating chrome: no blur, no translucency. */
  reduceTransparency: boolean;
  /**
   * Show the size and pixel dimensions under each tile in the gallery.
   *
   * Named for the card it changes rather than for the switch, because the two
   * places that render a tile read it directly.
   */
  showThumbnailMeta: boolean;
  /**
   * The master switch for everything that needs the local model service: OCR,
   * visual labels, embeddings and faces. Separate from `autoIndex`, which is
   * only about whether a change on disk starts work by itself.
   */
  localProcessing: boolean;
  /** Thumbnail column floor for the masonry grid, in pixels. */
  thumbnailSize: number;
  autoIndex: boolean;
  indexOnBattery: boolean;
  notifications: boolean;
  semanticSearch: boolean;
  llmEnabled: boolean;
  llmModel: string;
  servicePort: number;
  userName: string;
  accountLabel: string;
  /**
   * What the person at this machine says they keep here. Purely their own
   * description of the archive — it shapes nothing but the welcome copy — but
   * it is the difference between "a folder was indexed" and "your screenshots
   * are in".
   */
  useCases: string[];
  /** True once the first-run wizard has been completed or dismissed. */
  onboarded: boolean;
  /**
   * True when the wizard was reopened from Settings rather than shown on a
   * genuine first run — which is what lets it offer a way back out. Never
   * persisted: a restart always starts from the real state.
   */
  onboardingRestart: boolean;
  lastBackupAt: string | null;

  setAppearance: (appearance: Appearance) => void;
  setDensity: (density: Density) => void
  setThumbnailSize: (size: number) => void;
  setShowThumbnailMeta: (value: boolean) => void;
  setReduceTransparency: (value: boolean) => void;
  setLocalProcessing: (value: boolean) => void;
  setAutoIndex: (value: boolean) => void;
  setIndexOnBattery: (value: boolean) => void;
  setNotifications: (value: boolean) => void;
  setSemanticSearch: (value: boolean) => void;
  setLlmEnabled: (value: boolean) => void;
  setLlmModel: (value: string) => void;
  setServicePort: (value: number) => void;
  setUserName: (value: string) => void;
  setUseCases: (value: string[]) => void;
  /** Finish (or deliberately skip) the first-run wizard. */
  completeOnboarding: () => void;
  /** Show the wizard again from Settings. */
  restartOnboarding: () => void;
  markBackedUp: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      appearance: 'light',
      density: 'comfortable',
      reduceTransparency: false,
      showThumbnailMeta: true,
      thumbnailSize: 220,
      localProcessing: true,
      autoIndex: true,
      indexOnBattery: false,
      notifications: true,
      semanticSearch: false,
      llmEnabled: false,
      llmModel: 'llama3.2:3b',
      servicePort: 8765,
      // Filled in from the operating system's own account name on first launch
      // (see `useLocalIdentity`). Empty means "ask the machine", never a name
      // compiled into the application.
      userName: '',
      accountLabel: 'Local Account',
      useCases: [],
      onboarded: false,
      onboardingRestart: false,
      lastBackupAt: null,

      setAppearance: (appearance) => set({ appearance }),
      setDensity: (density) => set({ density }),
      setThumbnailSize: (thumbnailSize) => set({ thumbnailSize: Math.min(360, Math.max(150, thumbnailSize)) }),
      setShowThumbnailMeta: (showThumbnailMeta) => set({ showThumbnailMeta }),
      setReduceTransparency: (reduceTransparency) => set({ reduceTransparency }),
      // The switches below change what the backend actually does, so each one is
      // pushed to the host rather than only parked in local storage.
      setLocalProcessing: (localProcessing) => {
        set({ localProcessing });
        void getHost()
          .updatePreferences({ localProcessing })
          .catch(() => undefined);
      },
      setAutoIndex: (autoIndex) => {
        set({ autoIndex });
        void getHost()
          .updatePreferences({ autoIndex })
          .catch(() => undefined);
      },
      setIndexOnBattery: (indexOnBattery) => {
        set({ indexOnBattery });
        void getHost()
          .updatePreferences({ indexOnBattery })
          .catch(() => undefined);
      },
      setNotifications: (notifications) => set({ notifications }),
      setSemanticSearch: (semanticSearch) => {
        set({ semanticSearch });
        void getHost()
          .updatePreferences({ semanticSearch })
          .catch(() => undefined);
      },
      // The model switch and the model name both reach the backend, which is
      // what actually decides whether a query is interpreted and by which model.
      setLlmEnabled: (llmEnabled) => {
        set({ llmEnabled });
        void getHost()
          .updatePreferences({ llmEnabled })
          .catch(() => undefined);
      },
      setLlmModel: (llmModel) => {
        set({ llmModel });
        void getHost()
          .updatePreferences({ llmModel })
          .catch(() => undefined);
      },
      setServicePort: (servicePort) => {
        set({ servicePort });
        void getHost()
          .updatePreferences({ servicePort })
          .catch(() => undefined);
      },
      setUserName: (userName) => set({ userName }),
      setUseCases: (useCases) => set({ useCases }),
      completeOnboarding: () => set({ onboarded: true, onboardingRestart: false }),
      restartOnboarding: () => set({ onboarded: false, onboardingRestart: true }),
      markBackedUp: () => set({ lastBackupAt: new Date().toISOString() }),
    }),
    {
      name: 'afterimage.settings.v1',
      version: 1,
      storage: cookieBackedStorage,
      partialize: persistable,
    },
  ),
);
