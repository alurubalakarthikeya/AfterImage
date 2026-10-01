import { create } from 'zustand';
import {
  canPromptInstall,
  captureInstallPrompt,
  isIos,
  isStandalone,
  promptInstall,
} from '@/services/pwa';

/**
 * How this device can be offered the installed app.
 *
 * Four states rather than a pair of booleans, because they are four different
 * sentences and the interface should not be able to show two of them at once:
 *
 *   installed  it already is one — opened from a home screen or an app list
 *   prompt     the browser is holding an install prompt we may raise
 *   manual     iOS: there is no prompt, and the gesture is the Share sheet
 *   browser    nothing has been offered yet; the browser's own menu still can
 */
export type InstallMode = 'installed' | 'prompt' | 'manual' | 'browser';

function resolveMode(): InstallMode {
  if (isStandalone()) return 'installed';
  if (canPromptInstall()) return 'prompt';
  if (isIos()) return 'manual';
  return 'browser';
}

export interface PwaState {
  mode: InstallMode;
  /** True while the browser's prompt is on screen. */
  busy: boolean;
  /** Re-read the platform. Cheap, and the only thing that changes `mode`. */
  sync: () => void;
  /** Raise the browser's prompt; resolves with what the user chose. */
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

export const usePwaStore = create<PwaState>()((set) => ({
  mode: resolveMode(),
  busy: false,
  sync: () => set({ mode: resolveMode() }),
  install: async () => {
    set({ busy: true });
    try {
      const outcome = await promptInstall();
      // Whatever happened, the prompt has been spent — so the mode is re-read
      // rather than assumed: accepted lands on `installed`, dismissed falls back
      // to whichever of the other three the platform now reports.
      set({ mode: resolveMode() });
      return outcome;
    } finally {
      set({ busy: false });
    }
  },
}));

/**
 * Follow the platform's own opinion of whether this can be installed.
 *
 * Chromium offers an install prompt on its own schedule, and only offers it
 * again when something has changed — so the event has to be caught and held
 * when it arrives, and the interface reads the fact from the store rather than
 * subscribing to a browser event of its own.
 *
 * Returns the teardown, because the caller is a React effect.
 */
export function watchInstallability(): () => void {
  const sync = () => usePwaStore.getState().sync();
  const onPrompt = (event: Event) => {
    captureInstallPrompt(event);
    sync();
  };
  const onInstalled = () => sync();

  // Launching from a home screen an hour into a session is the same fact as
  // launching into it, and `display-mode` is how the platform reports it.
  const display = window.matchMedia('(display-mode: standalone)');

  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  display.addEventListener('change', sync);
  sync();

  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
    display.removeEventListener('change', sync);
  };
}
