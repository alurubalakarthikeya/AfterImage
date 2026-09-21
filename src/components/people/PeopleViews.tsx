import type { Person } from '@/types';
import { useUIStore } from '@/stores/ui';
import { cn, formatCount, formatRelativeTime } from '@/utils/format';
import { AssetImage } from '@/components/common/AssetImage';
import { Icon } from '@/components/common/Icon';
import { IconButton } from '@/components/common/IconButton';
import { Tooltip } from '@/components/common/Tooltip';
import { PersonCard } from './PersonCard';

/**
 * The People page, in whichever shape the toolbar asked for.
 *
 * People are not files, so they cannot reuse the file views — but they should
 * answer the same three questions the file views answer:
 *
 *   * **grid** — who is in this archive at all, as faces. The fastest way to
 *     recognise a group is to look at it.
 *   * **list** — the same people with their numbers and their last photograph
 *     in a column, which is what you want when you are cleaning up.
 *   * **timeline** — who the archive has seen most recently. A person's only
 *     meaningful date is the newest photograph they appear in, so that is what
 *     the timeline is built from, and a group whose files have all gone is
 *     listed under "No date yet" rather than filed under today.
 */

export interface PeopleViewProps {
  people: Person[];
  busy: boolean;
  onOpen: (personId: string) => void;
  onRename: (personId: string, label: string) => void;
  onForget: (person: Person) => void;
}

function monthLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'No date yet';
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function FaceAvatar({ person, size = 40 }: { person: Person; size?: number }) {
  return (
    <span
      className="block shrink-0 overflow-hidden rounded-full border border-line bg-surface-2"
      style={{ height: size, width: size }}
    >
      <AssetImage path={person.coverPath} alt="" fallbackIcon="User" />
    </span>
  );
}

/** One person on one line: the list view's unit, and the timeline's. */
function PersonRow({ person, busy, onOpen, onForget }: Omit<PeopleViewProps, 'people' | 'onRename'> & { person: Person }) {
  return (
    <div className="group/row flex items-center gap-3 rounded-thumb border border-line bg-surface px-3 py-2 transition-colors duration-150 hover:border-line-strong hover:bg-surface-2">
      <button
        type="button"
        onClick={() => onOpen(person.id)}
        aria-label={`Open ${person.label ?? 'this unnamed person'}`}
        className="shrink-0"
      >
        <FaceAvatar person={person} />
      </button>

      <button
        type="button"
        onClick={() => onOpen(person.id)}
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={cn(
            'block truncate text-body',
            person.label ? 'font-medium text-ink' : 'text-ink-3',
          )}
        >
          {person.label ?? 'Unnamed group'}
        </span>
        <span className="block truncate text-2xs text-ink-3">
          {person.lastSeenAt
            ? `Last photographed ${formatRelativeTime(person.lastSeenAt)}`
            : 'No photographs left in this group'}
        </span>
      </button>

      <span className="hidden shrink-0 text-right text-2xs tabular-nums text-ink-3 sm:block">
        {formatCount(person.fileCount)} {person.fileCount === 1 ? 'photo' : 'photos'}
        <span className="mx-1.5 opacity-40">·</span>
        {formatCount(person.faceCount)} {person.faceCount === 1 ? 'face' : 'faces'}
      </span>

      <Tooltip label="Delete this group" side="left">
        <IconButton
          label={`Delete ${person.label ?? 'this group'}`}
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => onForget(person)}
          className="shrink-0 opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          <Icon name="Trash2" size={14} strokeWidth={1.9} />
        </IconButton>
      </Tooltip>
    </div>
  );
}

export function PeopleViews({ people, busy, onOpen, onRename, onForget }: PeopleViewProps) {
  const viewMode = useUIStore((state) => state.viewMode);

  if (viewMode === 'list') {
    return (
      <div className="flex flex-col gap-1.5">
        {people.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            busy={busy}
            onOpen={onOpen}
            onForget={onForget}
          />
        ))}
      </div>
    );
  }

  if (viewMode === 'timeline') {
    // Newest first, and the groups are ordered by the same key they are split
    // on so the headings cannot arrive out of order.
    const dated = people
      .filter((person) => person.lastSeenAt)
      .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));
    const undated = people.filter((person) => !person.lastSeenAt);

    const months: Array<{ label: string; members: Person[] }> = [];
    for (const person of dated) {
      const label = monthLabel(person.lastSeenAt as string);
      const bucket = months[months.length - 1];
      if (bucket && bucket.label === label) bucket.members.push(person);
      else months.push({ label, members: [person] });
    }
    if (undated.length > 0) months.push({ label: 'No date yet', members: undated });

    return (
      <div className="flex flex-col gap-5">
        {months.map((month) => (
          <section key={month.label} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
              <h2 className="text-meta font-semibold text-ink">{month.label}</h2>
              <span className="text-2xs tabular-nums text-ink-3">
                {formatCount(month.members.length)}{' '}
                {month.members.length === 1 ? 'person' : 'people'}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {month.members.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  busy={busy}
                  onOpen={onOpen}
                  onForget={onForget}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
      {people.map((person) => (
        <PersonCard
          key={person.id}
          person={person}
          busy={busy}
          onOpen={() => onOpen(person.id)}
          onRename={(label) => onRename(person.id, label)}
          onForget={() => onForget(person)}
        />
      ))}
    </div>
  );
}

/** The skeleton both the grid and the list use while the first read lands. */
export function PeopleSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-[168px] animate-pulse rounded-card border border-line bg-surface"
        />
      ))}
    </div>
  );
}
