import { useEffect, useRef, useState } from 'react';
import type { Person } from '@/types';
import { cn, formatCount } from '@/utils/format';
import { AssetImage } from '@/components/common/AssetImage';
import { Icon } from '@/components/common/Icon';
import { IconButton } from '@/components/common/IconButton';

/**
 * One group of faces.
 *
 * The card is the naming surface, because naming is the only thing this feature
 * asks of the user: an unnamed group says "Add name" in the place the name would
 * be, which is a smaller ask than a dialog and does not have to be dismissed.
 *
 * The avatar is a real crop of the person's own face — the largest, sharpest,
 * most central one the index found. When a group somehow has no crop the card
 * falls back to a neutral glyph rather than a stand-in portrait.
 */
export function PersonCard({
  person,
  onOpen,
  onRename,
  onForget,
  busy = false,
}: {
  person: Person;
  onOpen: () => void;
  onRename: (label: string) => void;
  /** Delete the group. The caller confirms first — this just asks. */
  onForget?: () => void;
  busy?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(person.label ?? '');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  // A rename that lands while the card is idle keeps the draft in step; a draft
  // being typed into never gets overwritten.
  useEffect(() => {
    if (!editing) setDraft(person.label ?? '');
  }, [person.label, editing]);

  const commit = () => {
    setEditing(false);
    const clean = draft.trim();
    if (clean !== (person.label ?? '')) onRename(clean);
  };

  return (
    <article
      className={cn(
        'group relative flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-3 py-5 text-center',
        'transition-colors duration-150 hover:border-line-strong hover:bg-surface-2',
        busy && 'opacity-60',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${person.label ?? 'this unnamed person'}`}
        className="relative"
      >
        <span className="block h-[84px] w-[84px] overflow-hidden rounded-full border border-line bg-surface-2">
          <AssetImage path={person.coverPath} alt="" fallbackIcon="User" />
        </span>
      </button>

      {editing ? (
        <input
          ref={input}
          value={draft}
          autoFocus
          placeholder="Name"
          aria-label="Name this person"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft(person.label ?? '');
              setEditing(false);
            }
          }}
          className="w-full rounded-btn border border-accent bg-surface px-2 py-1 text-center text-body text-ink outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => (person.label ? onOpen() : setEditing(true))}
          className={cn(
            'max-w-full truncate rounded-[4px] px-1 text-card',
            person.label
              ? 'font-medium text-ink hover:text-accent-ink'
              : 'border-b border-dashed border-line-strong text-ink-3 hover:border-accent hover:text-ink',
          )}
        >
          {person.label ?? 'Add name'}
        </button>
      )}

      <p className="text-2xs tabular-nums text-ink-3">
        {formatCount(person.fileCount)} {person.fileCount === 1 ? 'photo' : 'photos'}
      </p>

      {!editing && (
        <div className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          {person.label && (
            <IconButton
              label={`Rename ${person.label}`}
              size="sm"
              variant="ghost"
              onClick={() => setEditing(true)}
            >
              <Icon name="Pencil" size={14} strokeWidth={1.9} />
            </IconButton>
          )}
          {onForget && (
            <IconButton
              label={`Delete ${person.label ?? 'this group'}`}
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onForget}
              className="hover:text-critical"
            >
              <Icon name="Trash2" size={14} strokeWidth={1.9} />
            </IconButton>
          )}
        </div>
      )}
    </article>
  );
}
