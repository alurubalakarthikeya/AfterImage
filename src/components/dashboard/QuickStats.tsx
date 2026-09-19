import type { RouteId } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { statTiles } from '@/stores/selectors';
import { useUIStore } from '@/stores/ui';
import { cn, formatCount } from '@/utils/format';
import { SectionHeader } from '@/components/common/Card';
import { Icon } from '@/components/common/Icon';

const ROUTE_FOR_KIND: Record<string, RouteId> = {
  photo: 'photos',
  screenshot: 'screenshots',
  document: 'documents',
  video: 'videos',
};

/**
 * Four counts.
 *
 * A 2×2 of tinted tiles was doing the one thing a statistics panel must not do:
 * making four numbers of equal weight look like four different things. It is a
 * hairline grid now — the figures are the only thing with weight.
 */
export function QuickStats({ className }: { className?: string }) {
  const totals = useArchiveStore((state) => state.totals);
  const navigate = useUIStore((state) => state.navigate);
  const tiles = statTiles(totals);

  return (
    <section
      className={cn('flex h-[188px] flex-col rounded-card border border-line bg-surface p-4', className)}
      aria-label="Library statistics"
    >
      <SectionHeader title="Library" actionLabel="View all" onAction={() => navigate('all')} />

      <div className="mt-3 grid flex-1 grid-cols-2 grid-rows-2">
        {tiles.map((tile, index) => (
          <button
            key={tile.label}
            type="button"
            onClick={() => navigate(ROUTE_FOR_KIND[tile.kind] ?? 'all')}
            className={cn(
              'flex flex-col items-start justify-center gap-0.5 rounded-[6px] px-3 text-left transition-colors duration-150 hover:bg-surface-2',
              // A cross of hairlines: the counts are separated by structure, not
              // by four competing background colours.
              index % 2 === 1 && 'border-l border-line',
              index >= 2 && 'border-t border-line',
              index % 2 === 0 && 'pl-0',
            )}
          >
            <span className="flex items-center gap-1.5 text-2xs text-ink-3">
              <Icon name={tile.icon} size={12} strokeWidth={1.9} />
              {tile.label}
            </span>
            <span className="text-[17px] font-semibold tabular-nums leading-tight tracking-[-0.01em] text-ink">
              {formatCount(tile.value)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
