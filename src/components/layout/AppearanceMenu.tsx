import { useEffect, useRef } from 'react';
import type { Appearance, Density } from '@/types';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

const APPEARANCES: Array<{ id: Appearance; label: string; icon: string }> = [
  { id: 'light', label: 'Light', icon: 'Sun' },
  { id: 'dark', label: 'Dark', icon: 'Moon' },
  { id: 'system', label: 'System', icon: 'Monitor' },
];

const DENSITIES: Array<{ id: Density; label: string; hint: string }> = [
  { id: 'comfortable', label: 'Comfortable', hint: 'Roomier rows' },
  { id: 'compact', label: 'Compact', hint: 'More per screen' },
];

/** Appearance popover: theme, density and thumbnail scale. */
export function AppearanceMenu() {
  const open = useUIStore((state) => state.appearanceOpen);
  const setOpen = useUIStore((state) => state.setAppearanceOpen);
  const appearance = useSettingsStore((state) => state.appearance);
  const density = useSettingsStore((state) => state.density);
  const thumbnailSize = useSettingsStore((state) => state.thumbnailSize);
  const reduceTransparency = useSettingsStore((state) => state.reduceTransparency);
  const setAppearance = useSettingsStore((state) => state.setAppearance);
  const setDensity = useSettingsStore((state) => state.setDensity);
  const setThumbnailSize = useSettingsStore((state) => state.setThumbnailSize);
  const setReduceTransparency = useSettingsStore((state) => state.setReduceTransparency);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="glass-float absolute right-0 top-[calc(100%+8px)] z-50 w-[268px] rounded-card border border-line p-3"
      style={{ boxShadow: 'var(--af-shadow-float)' }}
      role="dialog"
      aria-label="Appearance"
    >
      <div className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">Appearance</div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {APPEARANCES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setAppearance(option.id)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-[10px] border px-2 py-2.5 text-2xs font-medium transition-colors duration-150',
              appearance === option.id
                ? 'border-accent bg-surface-3 text-ink'
                : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
            )}
          >
            <Icon name={option.icon} size={15} strokeWidth={1.9} />
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-4 text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">Density</div>
      <div className="mt-2 flex rounded-[10px] border border-line bg-surface-2 p-0.5">
        {DENSITIES.map((option) => (
          <button
            key={option.id}
            type="button"
            title={option.hint}
            onClick={() => setDensity(option.id)}
            className={cn(
              'flex-1 rounded-[8px] px-2 py-1.5 text-2xs font-medium transition-colors duration-150',
              density === option.id ? 'bg-surface text-ink shadow-soft' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
          Thumbnails
        </span>
        <span className="text-2xs tabular-nums text-ink-3">{thumbnailSize}px</span>
      </div>
      <input
        type="range"
        min={150}
        max={360}
        step={10}
        value={thumbnailSize}
        onChange={(event) => setThumbnailSize(Number(event.target.value))}
        className="mt-2 w-full accent-[var(--af-accent)]"
        aria-label="Thumbnail size"
      />

      <label className="mt-4 flex cursor-pointer items-center justify-between gap-3">
        <span className="text-body text-ink-2">Reduce transparency</span>
        <input
          type="checkbox"
          checked={reduceTransparency}
          onChange={(event) => setReduceTransparency(event.target.checked)}
          className="h-4 w-4 accent-[var(--af-accent)]"
        />
      </label>
    </div>
  );
}
