import type { RouteId } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { statTiles } from '@/stores/selectors';
import { useUIStore } from '@/stores/ui';
import { cn, formatCount } from '@/utils/format';
import { Card, SectionHeader } from '@/components/common/Card';
import { Icon } from '@/components/common/Icon';

const TONE_SURFACE: Record<string, string> = {
  mint: 'bg-mint text-mint-ink',
  lavender: 'bg-lavender text-lavender-ink',
  peach: 'bg-peach text-peach-ink',
  blue: 'bg-blue text-blue-ink',
};

const ROUTE_FOR_KIND: Record<string, RouteId> = {
  photo: 'photos',
  screenshot: 'screenshots',
  document: 'documents',
  video: 'videos',
};

/** Four numbers, four tints. Quiet enough to sit beside the hero. */
export function QuickStats({ className }: { className?: string }) {
  const totals = useArchiveStore((state) => state.totals);
  const navigate = useUIStore((state) => state.navigate);
  const tiles = statTiles(totals);

  return (
    <Card className={cn('flex h-[250px] flex-col p-4', className)}>
      <SectionHeader title="Quick Stats" actionLabel="View all" onAction={() => navigate('all')} />

      <div className="mt-4 grid flex-1 grid-cols-2 grid-rows-2 gap-2.5">
        {tiles.map((tile) => (
          <button
            key={tile.label}
            type="button"
            onClick={() => navigate(ROUTE_FOR_KIND[tile.kind] ?? 'all')}
            className={cn(
              'flex flex-col justify-between rounded-thumb p-3 text-left transition-[transform,filter] duration-150 hover:-translate-y-px hover:brightness-[0.985]',
              TONE_SURFACE[tile.tone],
            )}
          >
            <span className="flex items-center justify-between">
              <span className="text-2xs font-medium opacity-75">{tile.label}</span>
              <Icon name={tile.icon} size={13} strokeWidth={1.9} className="opacity-45" />
            </span>
            <span className="text-[19px] font-semibold tabular-nums tracking-[-0.02em]">
              {formatCount(tile.value)}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}
