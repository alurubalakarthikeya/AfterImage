import { useState } from 'react';
import type { ArchiveCollection, SurfaceTone } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useCollectionStore } from '@/stores/collections';
import { useUIStore } from '@/stores/ui';
import { KIND_LABEL } from '@/stores/selectors';
import { useFileQuery } from '@/hooks/useFileQuery';
import { cn, formatCount, formatStorage } from '@/utils/format';
import { Page } from '@/components/common/Page';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { EmptyState } from '@/components/common/EmptyState';
import { AssetImage } from '@/components/common/AssetImage';
import { FileViews } from '@/components/files/FileViews';

const TONE: Record<SurfaceTone, { bg: string; ink: string }> = {
  mint: { bg: 'bg-mint', ink: 'text-mint-ink' },
  lavender: { bg: 'bg-lavender', ink: 'text-lavender-ink' },
  peach: { bg: 'bg-peach', ink: 'text-peach-ink' },
  blue: { bg: 'bg-blue', ink: 'text-blue-ink' },
  neutral: { bg: 'bg-surface-2', ink: 'text-ink-2' },
};

/** A collection's rule, in the words the user set it. */
function ruleText(collection: ArchiveCollection): string {
  if (collection.kind === 'manual') return 'Curated by hand';
  const bits: string[] = [];
  if (collection.rule?.kinds?.length) {
    bits.push(collection.rule.kinds.map((kind) => KIND_LABEL[kind]).join(', '));
  }
  if (collection.rule?.tags?.length) bits.push(`#${collection.rule.tags.join(' #')}`);
  if (collection.rule?.days) bits.push(`last ${collection.rule.days} days`);
  if (collection.rule?.favoritesOnly) bits.push('favourites');
  return bits.join(' · ') || 'Automatic';
}

/**
 * Collections.
 *
 * Manual collections and smart ones live together: the only difference the user
 * sees is a rule line and whether the count moves on its own. Both are resolved
 * by the index — this page never filters a cached list, so the collage and the
 * count always agree with what the archive actually holds.
 */
export function Collections() {
  const collections = useArchiveStore((state) => state.collections);
  const activeId = useUIStore((state) => state.activeCollectionId);
  const setActiveCollection = useUIStore((state) => state.setActiveCollection);
  const beginDraft = useCollectionStore((state) => state.beginDraft);
  const [sort] = useState<'recent'>('recent');

  const active = collections.find((collection) => collection.id === activeId) ?? null;
  const result = useFileQuery(active ? { collectionId: active.id, sort } : null);

  return (
    <Page>
      <PageHeader
        title="Collections"
        subtitle={
          collections.length === 0
            ? 'Nothing grouped yet — collections resolve from your tags, kinds and dates'
            : `${formatCount(collections.length)} collections · smart ones resolve from your tags, kinds and dates`
        }
      >
        <Button variant="secondary" size="sm" icon="FolderPlus" onClick={beginDraft}>
          New collection
        </Button>
      </PageHeader>

      {collections.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            compact
            icon="Layers"
            title="No collections yet"
            description="A collection is a view over the index — files are never moved on disk. Create one and its contents resolve from the rule you give it."
            actionLabel="New collection"
            onAction={beginDraft}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(258px,1fr))] gap-3">
          {collections.map((collection) => {
            const selected = collection.id === activeId;
            const tone = TONE[collection.surface];
            const preview = collection.preview.slice(0, 4);
            return (
              <button
                key={collection.id}
                type="button"
                onClick={() => setActiveCollection(selected ? null : collection.id)}
                className={cn(
                  'group/col flex flex-col gap-3 rounded-card border p-3.5 text-left transition-[border-color,transform] duration-150 hover:-translate-y-px',
                  selected ? 'border-accent/55' : 'border-line hover:border-line-strong',
                  tone.bg,
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={cn('flex min-w-0 items-center gap-2', tone.ink)}>
                    <Icon name={collection.icon} size={15} strokeWidth={1.9} className="shrink-0" />
                    <span className="truncate text-card font-semibold">{collection.name}</span>
                  </span>
                  <span className={cn('shrink-0 text-2xs tabular-nums opacity-70', tone.ink)}>
                    {formatCount(collection.fileCount)}
                  </span>
                </div>

                <div className="flex items-end gap-1.5">
                  {preview.length === 0
                    ? [0, 1, 2].map((index) => (
                        <span
                          key={index}
                          className="block flex-1 rounded-[7px] border border-dashed border-current opacity-20"
                          style={{ aspectRatio: '1' }}
                        />
                      ))
                    : preview.map((path) => (
                        <span
                          key={path}
                          className="block flex-1 overflow-hidden rounded-[7px] border border-white/50"
                          style={{ aspectRatio: '1' }}
                        >
                          <AssetImage path={path} alt="" />
                        </span>
                      ))}
                </div>

                <div className={cn('flex items-center justify-between gap-2 text-2xs opacity-75', tone.ink)}>
                  <span className="truncate">{ruleText(collection)}</span>
                  {collection.sizeBytes > 0 && (
                    <span className="shrink-0 tabular-nums">
                      {formatStorage(collection.sizeBytes)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {active && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-ink">{active.name}</h2>
            <span className="text-meta tabular-nums text-ink-3">
              {formatCount(result.total)} files
            </span>
            <span className="text-2xs text-ink-3">· {ruleText(active)}</span>
          </div>
          <FileViews
            result={result}
            emptyTitle="Nothing in this collection yet"
            emptyDescription="Smart collections fill up as you tag and index things. Add files from any file's context menu to fill it now."
          />
        </div>
      )}

      {!active && collections.length > 0 && (
        <p className="text-2xs text-ink-3">
          Collections are views over the index — they never move or copy files on disk.
        </p>
      )}
    </Page>
  );
}
