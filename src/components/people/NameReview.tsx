import { useEffect, useMemo, useState } from 'react';
import type { Person } from '@/types';
import { usePeopleStore } from '@/stores/people';
import { cn, formatCount } from '@/utils/format';
import { AssetImage } from '@/components/common/AssetImage';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Overlay';

/**
 * The step after a face pass: look at what came out of it, and put names on it.
 *
 * Categorisation ends with a *suggestion* of identity, and a suggestion nobody
 * reviews is a suggestion the archive keeps forever. So when groups come back
 * unnamed, this card appears above the grid with the faces themselves — four
 * crops of the same person, largest and sharpest first — because the question
 * is always "who is this?", and a question about a face is answered by looking
 * at the face rather than at a row count.
 *
 * Naming is a step in a wizard rather than a field on the card here, because
 * the review is a run: name one, next, name the next. Skipping is a real answer
 * and is offered beside every name — a group the user does not recognise now is
 * one they may recognise later, and nothing is lost by leaving it alone.
 */

/** How many unnamed groups the card shows before the count takes over. */
const PREVIEW = 6;

function Avatar({ person, size = 44 }: { person: Person; size?: number }) {
  return (
    <span
      className="block shrink-0 overflow-hidden rounded-full border border-line bg-surface-2"
      style={{ height: size, width: size }}
    >
      <AssetImage path={person.coverPath} alt="" fallbackIcon="User" />
    </span>
  );
}

/**
 * The invitation. Rendered only while there is something to review, and it
 * disappears the moment the last group is named — there is nothing to dismiss
 * when the work is done.
 */
export function NameReviewPrompt({
  people,
  onOpen,
}: {
  people: Person[];
  onOpen: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const unnamed = useMemo(
    () => people.filter((person) => !person.label && !person.hidden),
    [people],
  );

  useEffect(() => setDismissed(false), [unnamed.length]);

  if (unnamed.length === 0 || dismissed) return null;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex -space-x-2.5">
          {unnamed.slice(0, PREVIEW).map((person) => (
            <span key={person.id} className="block rounded-full ring-2 ring-surface">
              <Avatar person={person} size={38} />
            </span>
          ))}
        </div>

        <div className="min-w-[200px] flex-1">
          <h2 className="text-body font-semibold text-ink">
            {formatCount(unnamed.length)} {unnamed.length === 1 ? 'group is' : 'groups are'} ready to name
          </h2>
          <p className="mt-0.5 text-meta text-ink-2">
            The models grouped faces on this machine. Names are yours to give — skip any you do not
            recognise, and search will find them by name afterwards.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
            Later
          </Button>
          <Button variant="primary" size="sm" icon="PenLine" onClick={onOpen}>
            Review and name
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * The wizard itself: one unnamed group at a time, with its own crops and its
 * own two buttons.
 *
 * The draft lives per group rather than in one field, so going back to a group
 * the user already typed a name into shows what they typed rather than the
 * blank it started as.
 */
export function NameReview({
  open,
  people,
  onClose,
}: {
  open: boolean;
  people: Person[];
  onClose: () => void;
}) {
  const rename = usePeopleStore((state) => state.rename);
  const busy = usePeopleStore((state) => state.busy);

  const queue = useMemo(
    () => people.filter((person) => !person.label && !person.hidden),
    [people],
  );
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState('');

  // Land on the first group every time the wizard opens: a stale position from
  // last time would open on a group that has since been named.
  useEffect(() => {
    if (open) {
      setIndex(0);
      setDraft('');
    }
  }, [open]);

  const person = queue[Math.min(index, Math.max(0, queue.length - 1))];
  const finished = queue.length === 0 || index >= queue.length;

  if (!open) return null;

  const advance = () => {
    setDraft('');
    setIndex((current) => current + 1);
  };

  const save = () => {
    const clean = draft.trim();
    if (!clean || !person) return;
    void rename(person.id, clean).then(advance);
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-[520px]">
      <div className="p-5">
        {finished ? (
          <div className="flex flex-col items-start gap-3 py-2">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
              <Icon name="Check" size={20} strokeWidth={2} />
            </span>
            <div>
              <h2 className="text-section font-semibold text-ink">That is everyone for now</h2>
              <p className="mt-1 text-meta text-ink-2">
                The names you gave are in the archive — search finds them from here on. Groups you
                skipped are still on the People page whenever you want another look.
              </p>
            </div>
            <Button variant="primary" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                Group {index + 1} of {queue.length}
              </p>
              <span className="text-2xs tabular-nums text-ink-3">
                {formatCount(person.fileCount)} {person.fileCount === 1 ? 'photo' : 'photos'}
              </span>
            </div>

            {/* The crops are the evidence. Four is what reads as "the same
                person, seen again" rather than a single lucky shot. */}
            <div className="mt-3 flex items-center gap-2">
              {(person.samples.length > 0 ? person.samples : [null]).slice(0, 4).map((sample, i) => (
                <span
                  key={sample ?? i}
                  className={cn(
                    'block h-[76px] flex-1 overflow-hidden rounded-card border border-line bg-surface-2',
                    !sample && 'flex items-center justify-center text-ink-3',
                  )}
                >
                  {sample ? (
                    <AssetImage path={sample} alt="" fallbackIcon="User" className="h-full w-full" />
                  ) : (
                    <Icon name="User" size={22} strokeWidth={1.6} />
                  )}
                </span>
              ))}
            </div>

            <input
              value={draft}
              autoFocus
              placeholder="Who is this? (a name only you would recognise)"
              aria-label="Name this person"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') save();
                if (event.key === 'Escape') onClose();
              }}
              className="mt-4 w-full rounded-btn border border-line bg-surface px-3 py-2 text-body text-ink outline-none transition-colors duration-150 focus:border-accent"
            />

            <div className="mt-4 flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={advance} disabled={busy}>
                  Skip
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || draft.trim().length === 0}
                  onClick={save}
                >
                  Save name
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
