import { useMemo, useState } from 'react';
import type { ArchiveFile } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { topTags } from '@/stores/selectors';
import { Icon } from '@/components/common/Icon';
import { TagPill } from '@/components/common/Badge';
import { Tooltip } from '@/components/common/Tooltip';

/**
 * Tags on a file, in two groups.
 *
 * `#react` typed by a person and `#react` put there by the local models look the
 * same as index entries and behave the same in every search — but they are not
 * the same statement. One is the user's own word for their own file; the other
 * is the application's opinion about a picture it looked at. Showing them in one
 * undifferentiated row makes the application's guesses look like the user's
 * record of their own library, so they are drawn in two rows, and only the first
 * one is offered as something to edit.
 *
 * The inferred row is still removable: it deletes the tag, and the tag comes
 * back only if the file is looked at again. That is stated in the tooltip rather
 * than left for the user to discover.
 */
export function TagEditor({ file }: { file: ArchiveFile }) {
  const tags = useArchiveStore((state) => state.tags);
  const addTag = useArchiveStore((state) => state.addTag);
  const removeTag = useArchiveStore((state) => state.removeTag);
  const [editing, setEditing] = useState(false);

  const byId = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const { mine, inferred } = useMemo(() => {
    const machine = new Set(file.machineTagIds);
    const attached = file.tagIds.map((id) => byId.get(id)).filter(Boolean);
    return {
      mine: attached.filter((tag) => !machine.has(tag!.id)),
      inferred: attached.filter((tag) => machine.has(tag!.id)),
    };
  }, [file.tagIds, file.machineTagIds, byId]);

  const suggestions = useMemo(
    () => topTags(tags, 14).filter((tag) => !file.tagIds.includes(tag.id)).slice(0, 4),
    [tags, file.tagIds],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {mine.map((tag) => (
          <TagPill key={tag!.id} label={tag!.name} onRemove={() => removeTag(file.id, tag!.id)} />
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

      {inferred.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tooltip label="Inferred from this file's own content, on this machine" side="top">
            <span className="inline-flex items-center gap-1 text-2xs uppercase tracking-[0.06em] text-ink-3">
              <Icon name="ScanText" size={11} strokeWidth={2} />
              Inferred
            </span>
          </Tooltip>
          {inferred.map((tag) => (
            <TagPill
              key={tag!.id}
              label={tag!.name}
              className="border border-line bg-transparent text-ink-3"
              onRemove={() => removeTag(file.id, tag!.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
