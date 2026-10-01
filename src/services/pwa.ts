/**
 * Installability, and the offline shell.
 *
 * Everything the renderer needs to know about being an application rather than
 * a page: whether it already is one, whether this browser is offering to make
 * it one, and the one thing that has to happen for it to keep working when the
 * network is gone.
 *
 * No React here, and no store: these are facts about the platform, which do not
 * change when a component renders. The reactive half lives in `stores/pwa.ts`.
 */

import { isTauri } from './host';

/**
 * Chromium's install event, which TypeScript's DOM library does not describe.
 *
 * It is the only way to raise an install prompt at a moment of the app's own
 * choosing rather than the browser's, and it can be used exactly once.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;

/**
 * True when the app was launched as an application.
 *
 * Two answers, because there are two vocabularies: `display-mode` is the
 * standard one and is what an installed Chromium and an installed Android app
 * report; `navigator.standalone` is iOS's own, and it is still the only one an
 * iOS home-screen launch answers.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  return (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/**
 * True on an iPhone or an iPad.
 *
 * Asked because the answer decides which instructions are honest: iOS has no
 * install prompt to trigger, from any browser, and the gesture is a different
 * one — the Share sheet. Every browser on iOS is the same engine with the same
 * Share sheet, so this is a question about the platform, not about the browser.
 *
 * The second test catches an iPad, which reports itself as a Mac.
 */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const agent = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(agent)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** True when this browser has offered an install prompt we have not used yet. */
export function canPromptInstall(): boolean {
  return deferred !== null;
}

/**
 * Keep the browser's install prompt for later.
 *
 * Calling `preventDefault` is what stops Chrome raising its own mini-infobar
 * over the interface; the prompt is then ours to raise from the row in Settings
 * that explains what installing does. The event may only be used once, so the
 * reference is dropped the moment it is spent.
 */
export function captureInstallPrompt(event: Event): void {
  const candidate = event as InstallPromptEvent;
  if (typeof candidate.prompt !== 'function') return;
  event.preventDefault();
  deferred = candidate;
}

/** Raise the browser's install prompt. Resolves with what the user chose. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  }
}

/**
 * Register the offline shell.
 *
 * Three cases where a service worker would do harm rather than good, and all
 * three are skipped:
 *
 *   - Inside the desktop build. Its files are already on the disk it is running
 *     from, so there is nothing to be offline from, and a worker between the
 *     webview and its own bundle is a cache of the previous install.
 *   - Over a development server, where the modules being served are recompiled
 *     on every keystroke and the point of the browser is to show the newest one.
 *   - On an origin the platform does not consider secure. A worker is only
 *     allowed on HTTPS or loopback, so a copy of the site served over a LAN
 *     address is left alone rather than half-registered.
 */
export function registerOfflineShell(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (isTauri()) return;
  if (!import.meta.env.PROD) return;
  if (!window.isSecureContext) return;

  const start = () => {
    // `BASE_URL` rather than a literal, because the shell is served from the
    // same place the page was: both work from a sub-path, neither from a
    // hard-coded root.
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => undefined);
  };

  // After the first paint, so registering the worker is never part of the wait
  // for the interface to appear.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
