import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settings';

/**
 * Applies the chosen appearance to <html data-theme>.
 *
 * "System" follows the OS and keeps following it — no reload, no polling.
 * All colours are CSS variables, so this is the entire theme implementation.
 */
export function useAppearance(): void {
  const appearance = useSettingsStore((state) => state.appearance);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const resolved = appearance === 'system' ? (media.matches ? 'dark' : 'light') : appearance;
      document.documentElement.dataset.theme = resolved;
    };

    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance]);
}
