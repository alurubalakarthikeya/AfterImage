import type { ArchiveCollection } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useCollectionStore } from '@/stores/collections';
import { useUIStore } from '@/stores/ui';
import { cn, formatCount } from '@/utils/format';
import { SectionHeader } from '@/components/common/Card';
import { Icon } from '@/components/common/Icon';
import { AssetImage } from '@/components/common/AssetImage';

/**
 * Collections.
 *
 * Every row is a real collection with a real count and a strip built from
 * thumbnails of files that are genuinely in it. There are no cards named
 * "Design Inspiration" invented for the screenshot, and no pastel per
 * collection: a collection is identified by its name, not by a colour it was
 * assigned at random.
 */
export function SmartCollections({ className }: { className?: string }) {
  const collections = useArchiveStore((state) => state.collections);
  const open = useCollectionStore((state) => state.open);
  const navigate = useUIStore((state) => state.navigate);

  const rows = [...collections].sort((a, b) => b.fileCount - a.fileCount).slice(0, 4);

  if (rows.length === 0) {
    return (
      <section className={cn('flex flex-col', className)} aria-label="Collections">
        <SectionHeader
          title="Collections"
          actionLabel="All collections"
          onAction={() => navigate('collections')}
        />
        <div className="mt-3 flex items-start gap-3 rounded-thumb border border-dashed border-line-strong px-4 py-5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-3">
            <Icon name="Layers" size={15} strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <p className="text-body font-medium text-ink">No collections yet</p>
            <p className="mt-0.5 text-meta leading-relaxed text-ink-2">
              A collection is a saved view over this archive — a tag, a project, a folder or a
              search. Create the first one from the sidebar or from any file's context menu.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={cn('flex flex-col', className)} aria-label="Collections">
      <SectionHeader
        title="Collections"
        actionLabel="All collections"
        onAction={() => navigate('collections')}
      />

      <ul className="mt-2 divide-y divide-line">
        {rows.map((collection) => (
          <li key={collection.id}>
            <CollectionRow
              collection={collection}
              onOpen={() => open(collection.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The `surface` column on a collection is still stored — it is part of the data
 * model — but it is intentionally not rendered. Colour in this interface means
 * state, and a collection is not a state.
 */
function CollectionRow({
  collection,
  onOpen,
}: {
  collection: ArchiveCollection;
  onOpen: () => void;
}) {
  const preview = collection.preview.slice(0, 3);
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
      className="group/sc flex w-full items-center gap-3 py-2.5 text-left"
    >
      <span className="flex h-11 w-16 shrink-0 items-center gap-0.5 overflow-hidden rounded-[7px] border border-line bg-surface-2">
        {preview.length === 0
          ? [0, 1, 2].map((index) => (
              <span key={index} className="block h-full flex-1 bg-surface-3" />
            ))
          : preview.map((path) => (
              <span key={path} className="relative block h-full flex-1 overflow-hidden">
                <AssetImage path={path} alt="" />
              </span>
            ))}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-ink">{collection.name}</span>
        <span className="mt-px block truncate text-2xs text-ink-3">
          {formatCount(collection.fileCount)} files · {rule}
        </span>
      </span>

      <Icon
        name="ChevronRight"
        size={14}
        strokeWidth={2}
        className="shrink-0 text-ink-3 transition-transform duration-150 group-hover/sc:translate-x-0.5"
      />
    </button>
  );
}
