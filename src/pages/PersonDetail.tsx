import { useEffect, useMemo, useState } from 'react';
import type { Person } from '@/types';
import { getHost } from '@/services/host';
import { usePeopleStore } from '@/stores/people';
import { useUIStore } from '@/stores/ui';
import { useFileQuery } from '@/hooks/useFileQuery';
import { formatCount } from '@/utils/format';
import { Page } from '@/components/common/Page';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Icon } from '@/components/common/Icon';
import { AssetImage } from '@/components/common/AssetImage';
import { EmptyState } from '@/components/common/EmptyState';
import { Modal } from '@/components/common/Overlay';
import { FileViews } from '@/components/files/FileViews';

/**
 * One person's photographs.
 *
 * The list is the index's own answer to `personId` rather than a filter over a
 * cached page, so it stays right while the archive is still being indexed — and
 * the corrections that matter live here: a name, a merge when two people were
 * grouped as one, and hiding a group that is not a person at all.
 */
export function PersonDetail() {
  const personId = useUIStore((state) => state.activePersonId);
  const navigate = useUIStore((state) => state.navigate);

  const people = usePeopleStore((state) => state.people);
  const load = usePeopleStore((state) => state.load);
  const rename = usePeopleStore((state) => state.rename);
  const merge = usePeopleStore((state) => state.merge);
  const hide = usePeopleStore((state) => state.hide);
  const forget = usePeopleStore((state) => state.forget);
  const busy = usePeopleStore((state) => state.busy);

  const [person, setPerson] = useState<Person | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  // The store's copy is what a rename or a merge updates, so it wins when it
  // exists; the direct read covers arriving on a fresh launch at this route.
  useEffect(() => {
    if (!personId) {
      setPerson(null);
      return;
    }
    const known = people.find((item) => item.id === personId);
    if (known) setPerson(known);
    else void getHost().person(personId).then(setPerson).catch(() => setPerson(null));
  }, [personId, people]);

  const query = useMemo(
    () => (personId ? { personId, sort: 'recent' as const } : null),
    [personId],
  );
  const result = useFileQuery(query);

  if (!person) {
    return (
      <Page>
        <Button variant="ghost" size="sm" icon="ArrowLeft" onClick={() => navigate('people')}>
          All people
        </Button>
        <EmptyState
          icon="Users"
          title={personId ? 'This group is no longer here' : 'No person selected'}
          description={
            personId
              ? 'The groups change as the archive is regrouped. Open People to see the current ones.'
              : 'Choose somebody from the People page.'
          }
          actionLabel="Open People"
          onAction={() => navigate('people')}
        />
      </Page>
    );
  }

  const others = people.filter((item) => item.id !== person.id && !item.hidden);

  const startRename = () => {
    setDraft(person.label ?? '');
    setRenaming(true);
  };

  const commitRename = () => {
    setRenaming(false);
    const clean = draft.trim();
    if (clean !== (person.label ?? '')) void rename(person.id, clean);
  };

  return (
    <Page>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" icon="ArrowLeft" onClick={() => navigate('people')}>
          All people
        </Button>
      </div>

      <header className="flex flex-wrap items-center gap-4">
        <span className="block h-[72px] w-[72px] shrink-0 overflow-hidden rounded-full border border-line bg-surface-2">
          <AssetImage path={person.coverPath} alt="" fallbackIcon="User" />
        </span>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              value={draft}
              autoFocus
              placeholder="Name this person"
              aria-label="Name this person"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') setRenaming(false);
              }}
              className="w-full max-w-[320px] rounded-btn border border-accent bg-surface px-2.5 py-1.5 text-section text-ink outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={startRename}
              className="group/name flex max-w-full items-center gap-2 text-left"
            >
              <h1 className="truncate text-title font-semibold tracking-[-0.02em] text-ink">
                {person.label ?? 'Unnamed person'}
              </h1>
              <Icon
                name="Pencil"
                size={15}
                strokeWidth={1.9}
                className="shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 group-hover/name:opacity-100"
              />
            </button>
          )}
          <p className="mt-1 text-meta text-ink-2">
            {formatCount(person.fileCount)} {person.fileCount === 1 ? 'photograph' : 'photographs'}
            {' · '}
            {formatCount(person.faceCount)} {person.faceCount === 1 ? 'face' : 'faces'}
            {person.hidden && ' · hidden from People'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {person.hidden ? (
            <Button
              variant="secondary"
              size="sm"
              icon="Eye"
              disabled={busy}
              onClick={() => void getHost().setPersonHidden(person.id, false).then(() => load())}
            >
              Show again
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon="Layers"
                disabled={busy || others.length === 0}
                onClick={() => setMergeOpen((open) => !open)}
              >
                Merge into…
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="EyeOff"
                disabled={busy}
                onClick={() => void hide(person.id)}
              >
                Not a person
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="Trash2"
                disabled={busy}
                className="hover:text-critical"
                onClick={() => setConfirmForget(true)}
              >
                Delete group
              </Button>
            </>
          )}
        </div>
      </header>

      <Modal open={confirmForget} onClose={() => setConfirmForget(false)} className="max-w-[440px]">
        <div className="p-5">
          <h2 className="text-section font-semibold text-ink">
            Delete {person.label ?? 'this group'}?
          </h2>
          <p className="mt-2 text-meta leading-relaxed text-ink-2">
            The group and the {formatCount(person.faceCount)} faces behind it are removed from
            the index. Your photographs are never touched — nothing is moved, renamed or deleted
            on disk.
          </p>
          <p className="mt-2 text-meta leading-relaxed text-ink-2">
            This one is permanent: a face pass skips photographs it has already looked at, so the
            group cannot reassemble itself. To get it back you would have to rescan the folder it
            came from.
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmForget(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon="Trash2"
              disabled={busy}
              onClick={() => {
                setConfirmForget(false);
                void forget(person.id);
              }}
            >
              Delete group
            </Button>
          </div>
        </div>
      </Modal>

      {mergeOpen && (
        <Card>
          <div className="p-2">
            <p className="px-2 py-1.5 text-2xs uppercase tracking-wide text-ink-3">
              Merge {person.label ?? 'this group'} into
            </p>
            <div className="scroll-fade-y max-h-[260px] overflow-y-auto">
              {others.map((other) => (
                <button
                  key={other.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMergeOpen(false);
                    void merge(person.id, other.id);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-btn px-2 py-1.5 text-left transition-colors duration-100 hover:bg-surface-3 disabled:opacity-40"
                >
                  <span className="block h-7 w-7 shrink-0 overflow-hidden rounded-full border border-line bg-surface-2">
                    <AssetImage path={other.coverPath} alt="" fallbackIcon="User" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body text-ink">
                    {other.label ?? 'Unnamed person'}
                  </span>
                  <span className="shrink-0 text-2xs tabular-nums text-ink-3">
                    {formatCount(other.fileCount)}
                  </span>
                </button>
              ))}
            </div>
            <p className="px-2 py-1.5 text-2xs text-ink-3">
              The photographs of both groups end up under one name. Nothing on disk is moved.
            </p>
          </div>
        </Card>
      )}

      <FileViews
        result={result}
        kind="photo"
        emptyTitle="No photographs in this group"
        emptyDescription="Every file behind this group has been moved, trashed or removed from the index."
      />
    </Page>
  );
}
