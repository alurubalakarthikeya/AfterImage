import { useEffect } from 'react';
import { getHost } from '@/services/host';
import { useSettingsStore } from '@/stores/settings';

/** `karthikeya` → `Karthikeya`. The account name arrives lowercase on Windows. */
function displayName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Greets whoever is actually using the machine.
 *
 * On first launch the display name is empty, so the operating system is asked
 * once and the answer is persisted. After that the stored value wins, because by
 * then it is the user's own choice — a name they typed is not second-guessed by
 * the account they happened to log in as.
 */
export function useLocalIdentity(): void {
  const userName = useSettingsStore((state) => state.userName);
  const setUserName = useSettingsStore((state) => state.setUserName);

  useEffect(() => {
    if (userName.trim()) return;

    let cancelled = false;
    getHost()
      .identity()
      .then((identity) => {
        const name = displayName(identity?.userName ?? '');
        if (!cancelled && name) setUserName(name);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [userName, setUserName]);
}
