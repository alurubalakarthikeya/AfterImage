import { useMemo, useState } from 'react';
import type { ArchiveFile } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { topTags } from '@/stores/selectors';
import { Icon } from '@/components/common/Icon';
import { TagPill } from '@/components/common/Badge';

/** Tags on a file: existing pills, then an inline add control. */
export function TagEditor({ file }: { file: ArchiveFile }) {
  const tags = useArchiveStore((state) => state.tags);
  const addTag = useArchiveStore((state) => state.addTag);
  const removeTag = useArchiveStore((state) => state.removeTag);
  const [editing, setEditing] = useState(false);

  const attached = useMemo(
    () => file.tagIds.map((id) => tags.find((tag) => tag.id === id)).filter(Boolean),
    [file.tagIds, tags],
  );

  const suggestions = useMemo(
    () => topTags(tags, 14).filter((tag) => !file.tagIds.includes(tag.id)).slice(0, 4),
    [tags, file.tagIds],
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attached.map((tag) => (
        <TagPill
          key={tag!.id}
          label={tag!.name}
          onRemove={() => removeTag(file.id, tag!.id)}
        />
      ))}

      {editing ? (
        <input
          autoFocus
          onBlur={(event) => {
            if (event.target.value.trim()) addTag(file.id, event.target.value);
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const value = (event.target as HTMLInputElement).value;
              if (value.trim()) addTag(file.id, value);
              setEditing(false);
            }
            if (event.key === 'Escape') setEditing(false);
          }}
          placeholder="tag name"
          className="h-[26px] w-[104px] rounded-pill border border-line-strong bg-surface px-2.5 text-meta text-ink outline-none focus:border-line-strong"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-pill border border-dashed border-line-strong py-[5px] pl-2 pr-2.5 text-meta text-ink-3 transition-colors duration-150 hover:border-line-strong hover:text-accent-ink"
        >
          <Icon name="Plus" size={11} strokeWidth={2.4} />
          Add tag
        </button>
      )}

      {!editing &&
        suggestions.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => addTag(file.id, tag.name)}
            className="rounded-pill border border-transparent py-[5px] pl-[9px] pr-[9px] text-meta text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink-2"
            title={`Add #${tag.name}`}
          >
            #{tag.name}
          </button>
        ))}
    </div>
  );
}
