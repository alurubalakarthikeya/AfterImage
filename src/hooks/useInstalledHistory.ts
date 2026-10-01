import { useEffect } from 'react';
import type { RouteId } from '@/types';
import { isTauri } from '@/services/host';
import { isStandalone } from '@/services/pwa';
import { useUIStore } from '@/stores/ui';

/** What the app writes into a history entry so it can find its way back. */
interface EntryState {
  route: RouteId;
  personId: string | null;
}

/**
 * The back gesture, inside the installed app.
 *
 * Behind an installed icon there is no browser chrome: no back button, no
 * address bar, and on Android the system back gesture leaves the app outright
 * unless something has told the platform where the user came from. So the app
 * keeps its own stack in the session history — one entry per section, written
 * when the section changes and read back when the gesture arrives.
 *
 * Only in the installed app. In a browser tab the back button belongs to the
 * browser and to the pages the user visited before this one, and taking it over
 * to mean "the previous section of a single-page application" is a change
 * nobody asked for. `isStandalone()` is the line: installed, or not running in
 * a tab at all.
 *
 * The first entry is labelled rather than left empty, so the gesture from any
 * section arrives at Home instead of leaving the application — and the press
 * after that is the platform's, which is the correct number of presses to close
 * an app.
 */
export function useInstalledHistory(): void {
  useEffect(() => {
    if (isTauri() || !isStandalone()) return;

    // Set while the app is being moved by the gesture, so restoring a section
    // does not write a second entry for the place it just left.
    let restoring = false;

    const entry = (): EntryState => {
      const state = useUIStore.getState();
      return { route: state.route, personId: state.activePersonId };
    };

    history.replaceState(entry(), '');

    const unsubscribe = useUIStore.subscribe((state, previous) => {
      if (restoring) return;
      if (state.route === previous.route && state.activePersonId === previous.activePersonId) return;
      history.pushState({ route: state.route, personId: state.activePersonId }, '');
    });

    const onPop = (event: PopStateEvent) => {
      // An overlay is the top of the stack in every interface there is, so the
      // gesture closes that first — and the entry it just consumed is written
      // back, because dismissing something is not a step backwards through the
      // sections and should not cost one.
      if (useUIStore.getState().dismissTop()) {
        history.pushState(entry(), '');
        return;
      }

      const wanted = event.state as EntryState | null;
      // No state at all means this entry belongs to whatever was on screen
      // before the app was ever opened. That one is the platform's to handle.
      if (!wanted?.route) return;

      restoring = true;
      try {
        if (wanted.route === 'person' && wanted.personId) {
          useUIStore.getState().openPerson(wanted.personId);
        } else {
          useUIStore.getState().navigate(wanted.route);
        }
      } finally {
        restoring = false;
      }
    };

    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      unsubscribe();
    };
  }, []);
}
