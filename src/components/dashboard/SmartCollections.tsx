import type { ArchiveCollection, SurfaceTone } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useCollectionStore } from '@/stores/collections';
import { useUIStore } from '@/stores/ui';
import { cn, formatCount } from '@/utils/format';
import { Card, SectionHeader } from '@/components/common/Card';
import { Icon } from '@/components/common/Icon';
import { AssetImage } from '@/components/common/AssetImage';

const TONE: Record<SurfaceTone, { bg: string; ink: string }> = {
  mint: { bg: 'bg-mint', ink: 'text-mint-ink' },
  lavender: { bg: 'bg-lavender', ink: 'text-lavender-ink' },
  peach: { bg: 'bg-peach', ink: 'text-peach-ink' },
  blue: { bg: 'bg-blue', ink: 'text-blue-ink' },
  neutral: { bg: 'bg-surface-2', ink: 'text-ink-2' },
};

/**
 * Collections.
 *
 * Every card is a real collection row with a real file count and a collage built
 * from thumbnails of files that are actually in it. There are no placeholders
 * named "Design Inspiration" invented for the screenshot — a collection appears
 * here because it exists in the database, and when none do, this says so.
 */
export function SmartCollections({ className }: { className?: string }) {
  const collections = useArchiveStore((state) => state.collections);
  const open = useCollectionStore((state) => state.open);
  const navigate = useUIStore((state) => state.navigate);

  const cards = [...collections].sort((a, b) => b.fileCount - a.fileCount).slice(0, 4);

  return (
    <Card className={cn('flex flex-col p-4', className)}>
      <SectionHeader
        title="Collections"
        subtitle="Smart rules and anything you grouped by hand"
        actionLabel="All collections"
        onAction={() => navigate('collections')}
      />

      {cards.length === 0 ? (
        <div className="mt-4 flex flex-1 flex-col items-start justify-center gap-2 rounded-panel border border-dashed border-line-strong p-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-ink-3">
            <Icon name="Layers" size={16} strokeWidth={1.8} />
          </span>
          <p className="text-card font-semibold text-ink">No collections yet</p>
          <p className="max-w-[380px] text-meta leading-relaxed text-ink-2">
            Collections group files across folders. Create one from the sidebar, or from any file's
            context menu, and its contents resolve from tags, projects and saved searches.
          </p>
          <button
            type="button"
            onClick={() => navigate('collections')}
            className="mt-1 inline-flex items-center gap-1.5 rounded-btn border border-line-strong px-3 py-1.5 text-meta font-medium text-ink transition-colors duration-150 hover:bg-surface-3"
          >
            Create a collection
            <Icon name="ArrowRight" size={12} strokeWidth={2.2} />
          </button>
        </div>
      ) : (
        <div className="mt-4 grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <CollectionCard key={card.id} collection={card} onOpen={() => open(card.id)} />
          ))}
        </div>
      )}
    </Card>
  );
}

function CollectionCard({
  collection,
  onOpen,
}: {
  collection: ArchiveCollection;
  onOpen: () => void;
}) {
  const tone = TONE[collection.surface];
  const preview = collection.preview.slice(0, 4);

  const rule =
    collection.rule?.tags?.length
      ? `Tagged ${collection.rule.tags.join(', ')}`
      : collection.rule?.kinds?.length
        ? `Types: ${collection.rule.kinds.join(', ')}`
        : collection.rule?.days
          ? `Last ${collection.rule.days} days`
          : collection.kind === 'smart'
            ? 'Smart rule'
            : 'Chosen by hand';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group/sc flex flex-col justify-between gap-3 rounded-thumb p-3.5 text-left transition-[transform,filter] duration-150 hover:-translate-y-px hover:brightness-[0.985]',
        tone.bg,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={cn('truncate text-card font-semibold tracking-[-0.01em]', tone.ink)}>
            {collection.name}
          </div>
          <div className={cn('mt-0.5 truncate text-2xs opacity-70', tone.ink)}>
            {formatCount(collection.fileCount)} files · {rule}
          </div>
        </div>
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/55 transition-transform duration-150 group-hover/sc:translate-x-0.5',
            tone.ink,
          )}
        >
          <Icon name="ArrowRight" size={13} strokeWidth={2.2} />
        </span>
      </div>

      <div className="flex items-end gap-1.5">
        {preview.length === 0
          ? [0, 1, 2].map((index) => (
              <span
                key={index}
                className="block flex-1 overflow-hidden rounded-[8px] border border-white/50 bg-white/40"
                style={{ aspectRatio: '1' }}
              />
            ))
          : preview.map((path, index) => (
              <span
                key={path}
                className="relative block flex-1 overflow-hidden rounded-[8px] border border-white/50 bg-white/50"
                style={{ aspectRatio: '1', transform: `translateY(${index % 2 === 0 ? 0 : -3}px)` }}
              >
                <AssetImage path={path} alt="" />
              </span>
            ))}
      </div>
    </button>
  );
}
