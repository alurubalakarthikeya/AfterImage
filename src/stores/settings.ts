import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Appearance, Density } from '@/types';
import { getHost } from '@/services/host';

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
  /** Highlight the accent tint on hovered/selected chrome. */
  reduceTransparency: boolean;
  showThumbnailMeta: boolean;
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
  lastBackupAt: string | null;

  setAppearance: (appearance: Appearance) => void;
  setDensity: (density: Density) => void
  setThumbnailSize: (size: number) => void;
  setShowThumbnailMeta: (value: boolean) => void;
  setReduceTransparency: (value: boolean) => void;
  setAutoIndex: (value: boolean) => void;
  setIndexOnBattery: (value: boolean) => void;
  setNotifications: (value: boolean) => void;
  setSemanticSearch: (value: boolean) => void;
  setLlmEnabled: (value: boolean) => void;
  setLlmModel: (value: string) => void;
  setServicePort: (value: number) => void;
  setUserName: (value: string) => void;
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
      lastBackupAt: null,

      setAppearance: (appearance) => set({ appearance }),
      setDensity: (density) => set({ density }),
      setThumbnailSize: (thumbnailSize) => set({ thumbnailSize: Math.min(360, Math.max(150, thumbnailSize)) }),
      setShowThumbnailMeta: (showThumbnailMeta) => set({ showThumbnailMeta }),
      setReduceTransparency: (reduceTransparency) => set({ reduceTransparency }),
      // The switches below change what the backend actually does, so each one is
      // pushed to the host rather than only parked in local storage.
      setAutoIndex: (autoIndex) => {
        set({ autoIndex });
        void getHost()
          .updatePreferences({ localProcessing: autoIndex })
          .catch(() => undefined);
      },
      setIndexOnBattery: (indexOnBattery) => set({ indexOnBattery }),
      setNotifications: (notifications) => set({ notifications }),
      setSemanticSearch: (semanticSearch) => {
        set({ semanticSearch });
        void getHost()
          .updatePreferences({ semanticSearch })
          .catch(() => undefined);
      },
      setLlmEnabled: (llmEnabled) => set({ llmEnabled }),
      setLlmModel: (llmModel) => set({ llmModel }),
      setServicePort: (servicePort) => {
        set({ servicePort });
        void getHost()
          .updatePreferences({ servicePort })
          .catch(() => undefined);
      },
      setUserName: (userName) => set({ userName }),
      markBackedUp: () => set({ lastBackupAt: new Date().toISOString() }),
    }),
    {
      name: 'afterimage.settings.v1',
      version: 1,
      partialize: (state) => ({
        appearance: state.appearance,
        density: state.density,
        reduceTransparency: state.reduceTransparency,
        showThumbnailMeta: state.showThumbnailMeta,
        thumbnailSize: state.thumbnailSize,
        autoIndex: state.autoIndex,
        indexOnBattery: state.indexOnBattery,
        notifications: state.notifications,
        semanticSearch: state.semanticSearch,
        llmEnabled: state.llmEnabled,
        llmModel: state.llmModel,
        servicePort: state.servicePort,
        userName: state.userName,
        accountLabel: state.accountLabel,
        lastBackupAt: state.lastBackupAt,
      }),
    },
  ),
);
