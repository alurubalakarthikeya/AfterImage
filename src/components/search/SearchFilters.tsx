import type { FileKind } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useSearchStore } from '@/stores/search';
import { topTags } from '@/stores/selectors';
import { cn } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

const KINDS: Array<{ kind: FileKind; label: string; icon: string }> = [
  { kind: 'screenshot', label: 'Screenshots', icon: 'MonitorSmartphone' },
  { kind: 'photo', label: 'Photos', icon: 'Image' },
  { kind: 'document', label: 'Documents', icon: 'FileText' },
  { kind: 'video', label: 'Videos', icon: 'Film' },
  { kind: 'design', label: 'Design', icon: 'Palette' },
  { kind: 'audio', label: 'Audio', icon: 'Music' },
];

const WINDOWS: Array<{ days: number; label: string }> = [
  { days: 1, label: 'Today' },
  { days: 7, label: 'This week' },
  { days: 30, label: 'This month' },
  { days: 365, label: 'This year' },
];

/**
 * Filters.
 *
 * Every control here writes to the same structured query the parser produces,
 * so a typed filter and a clicked one are indistinguishable downstream.
 */
export function SearchFilters() {
  const filters = useSearchStore((state) => state.filters);
  const setFilter = useSearchStore((state) => state.setFilter);
  const clearFilters = useSearchStore((state) => state.clearFilters);
  const tags = useArchiveStore((state) => state.tags);

  const suggestions = topTags(tags, 10);
  const activeCount =
    (filters.kind ? 1 : 0) +
    filters.tagIds.length +
    (filters.favoritesOnly ? 1 : 0) +
    (filters.sinceDays ? 1 : 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h3 className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">Filters</h3>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-2xs text-ink-3 transition-colors hover:text-ink"
          >
            Clear ({activeCount})
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-2xs text-ink-3">Type</span>
        {KINDS.map((option) => {
          const active = filters.kind === option.kind;
          return (
            <button
              key={option.kind}
              type="button"
              onClick={() => setFilter({ kind: active ? undefined : option.kind })}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-[9px] px-2 text-left text-meta transition-colors duration-150',
                active ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
              )}
            >
              <Icon name={option.icon} size={14} strokeWidth={1.9} />
              <span className="flex-1 truncate">{option.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-2xs text-ink-3">Added</span>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {WINDOWS.map((option) => {
            const active = filters.sinceDays === option.days;
            return (
              <button
                key={option.days}
                type="button"
                onClick={() => setFilter({ sinceDays: active ? undefined : option.days })}
                className={cn(
                  'rounded-pill px-2.5 py-1 text-2xs transition-colors duration-150',
                  active
                    ? 'bg-accent-soft text-accent-ink'
                    : 'bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-meta text-ink-2">
          <Icon name="Star" size={13} strokeWidth={1.9} />
          Favourites only
        </span>
        <input
          type="checkbox"
          checked={filters.favoritesOnly}
          onChange={(event) => setFilter({ favoritesOnly: event.target.checked })}
          className="h-4 w-4 accent-[var(--af-accent)]"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-2xs text-ink-3">Tags</span>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((tag) => {
            const active = filters.tagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() =>
                  setFilter({
                    tagIds: active
                      ? filters.tagIds.filter((id) => id !== tag.id)
                      : [...filters.tagIds, tag.id],
                  })
                }
                className={cn(
                  'inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-2xs transition-colors duration-150',
                  active
                    ? 'bg-accent-soft text-accent-ink'
                    : 'bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink',
                )}
              >                  #{tag.name}
                <span className="tabular-nums text-ink-3">{tag.count}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
