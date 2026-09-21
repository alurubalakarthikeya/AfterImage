/**
 * Boot guard.
 *
 * A packaged webview has no console anyone can open, so a failure during
 * startup is indistinguishable from a slow one: the user sees a window that
 * never resolves and there is nothing to read. This module is imported before
 * anything else and does two things:
 *
 *   1. reports startup milestones and failures to the application log, through
 *      the raw Tauri bridge, so they are visible from outside the window;
 *   2. if the interface never renders, says so plainly on screen instead of
 *      leaving a blank rectangle.
 *
 * It is deliberately dependency-free and imports nothing that could itself
 * fail — it is the thing that has to work when nothing else does.
 */

interface TauriInternals {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function bridge(): TauriInternals | undefined {
  return (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
}

/** Report to the application log. Never throws, never awaited. */
export function report(stage: string): void {
  try {
    void bridge()?.invoke?.('frontend_probe', { message: stage });
  } catch {
    /* the reporter must never be the thing that breaks the boot */
  }
}

const started = Date.now();

/** The splash is markup, not React, so it can be dismissed the moment the app does. */
export function dismissSplash(): void {
  const splash = document.getElementById('af-splash');
  if (!splash) return;
  splash.classList.add('af-splash-out');
  window.setTimeout(() => splash.remove(), 260);
}

/** Proof, in the log, that the bundle was evaluated at all. */
report('boot: bundle evaluated');

const PANEL =
  'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;' +
  'justify-content:center;gap:10px;padding:32px;text-align:center;' +
  'font:400 13px/1.6 ui-sans-serif,system-ui,sans-serif;background:#f6f8fa;color:#1f2328';

/** Replace an empty shell with a sentence a person can act on. */
function surface(reason: string): void {
  report(`boot: ${reason}`);
  dismissSplash();
  const root = document.getElementById('root');
  if (!root || root.childElementCount > 0) return;
  const panel = document.createElement('div');
  panel.setAttribute('style', PANEL);
  const title = document.createElement('div');
  title.setAttribute('style', 'font-weight:600;font-size:15px');
  title.textContent = 'AfterImage could not start';
  const detail = document.createElement('div');
  detail.setAttribute('style', 'max-width:520px;opacity:.75;font-family:ui-monospace,monospace');
  detail.textContent = reason;
  panel.append(title, detail);
  root.appendChild(panel);
}

/**
 * Thumbnail outcomes.
 *
 * Images are the one resource whose failure is otherwise silent: an <img> that
 * cannot be fetched throws nothing and rejects nothing, it simply never paints
 * — which from outside the window is indistinguishable from a file that has no
 * thumbnail to show. So the two counts below are reported by the component that
 * renders the pictures, where the outcome is already known: the first success
 * proves the pipeline reaches the screen, and the first few failures name the
 * files it did not.
 */
let imageSuccesses = 0;
let imageFailures = 0;

export function reportImage(ok: boolean, detail: string): void {
  if (ok) {
    if (imageSuccesses === 0) report(`images: first thumbnail rendered (${detail})`);
    imageSuccesses += 1;
    return;
  }
  if (imageFailures < 5) report(`images: failed (${detail})`);
  imageFailures += 1;
}

window.addEventListener(
  'error',
  (event) => {
    // Resource errors reach the window through capture, not bubbling. They are
    // counted elsewhere; what belongs here is everything that actually threw.
    if ((event.target as HTMLElement | null)?.tagName === 'IMG') return;
    surface(`uncaught error: ${event.message || 'unknown'}`);
  },
  true,
);

window.addEventListener('unhandledrejection', (event) => {
  surface(`unhandled rejection: ${String((event as PromiseRejectionEvent).reason)}`);
});

// The one case the handlers above cannot catch: nothing ran and nothing threw.
window.setTimeout(() => {
  const root = document.getElementById('root');
  if (root && root.childElementCount === 0) {
    const tauri = bridge() ? 'present' : 'missing';
    surface(`no interface after ${Date.now() - started}ms (tauri bridge: ${tauri})`);
  }
}, 5000);
