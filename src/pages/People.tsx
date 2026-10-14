import { useEffect, useMemo, useState } from 'react';
import type { Person } from '@/types';
import { usePeopleStore } from '@/stores/people';
import { useUIStore } from '@/stores/ui';
import { formatCount } from '@/utils/format';
import { Page } from '@/components/common/Page';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Overlay';
import { AssetImage } from '@/components/common/AssetImage';
import { PeopleSkeleton, PeopleViews } from '@/components/people/PeopleViews';
import { NameReview, NameReviewPrompt } from '@/components/people/NameReview';

/**
 * People.
 *
 * Every group of faces the index believes is one person, on this machine, from
 * the user's own photographs. The page is honest about the three states it can
 * be in: the models are missing, the models are present but nothing has been
 * looked at, and there are groups to name.
 */
export function People() {
  const status = usePeopleStore((state) => state.status);
  const people = usePeopleStore((state) => state.people);
  const stats = usePeopleStore((state) => state.stats);
  const available = usePeopleStore((state) => state.available);
  const reason = usePeopleStore((state) => state.reason);
  const error = usePeopleStore((state) => state.error);
  const models = usePeopleStore((state) => state.models);
  const busy = usePeopleStore((state) => state.busy);
  const load = usePeopleStore((state) => state.load);
  const loadModels = usePeopleStore((state) => state.loadModels);
  const installModels = usePeopleStore((state) => state.installModels);
  const scan = usePeopleStore((state) => state.scan);
  const regroup = usePeopleStore((state) => state.regroup);
  const rename = usePeopleStore((state) => state.rename);
  const forget = usePeopleStore((state) => state.forget);
  const mergeMany = usePeopleStore((state) => state.mergeMany);
  const openPerson = useUIStore((state) => state.openPerson);

  // Deleting a group is irreversible in a way the other actions on this page
  // are not, so it is the one thing here that asks first.
  const [target, setTarget] = useState<Person | null>(null);

  // Merging asks first too — but for a different reason: several groups fold
  // into one in a single step, and which one survives decides whose name the
  // photographs end up under.
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [confirmMerge, setConfirmMerge] = useState(false);

  // The review that follows a face pass: name them now, skip one, or dismiss
  // the whole thing. It never blocks the page — it sits above the grid.
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    void load();
    void loadModels();
  }, [load, loadModels]);

  const faces = models?.bundles.find((bundle) => bundle.name === 'faces');
  const cost = faces ? Math.round(faces.megabytes) : null;

  const subtitle = [
    'Grouped on this machine from the faces in your photographs',
    stats.people > 0 ? `${formatCount(stats.unnamed)} still to name` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Whose name survives the merge: the first selected group that already has
  // one, because a name the user typed is worth more than a position in a
  // list — and when none has a name, the first pick, which is the one they
  // pointed at first.
  const mergeSurvivor = useMemo(() => {
    const picked = chosen
      .map((id) => people.find((person) => person.id === id))
      .filter((person): person is Person => Boolean(person));
    return picked.find((person) => person.label) ?? picked[0] ?? null;
  }, [chosen, people]);

  return (
    <Page>
      <PageHeader title="People" subtitle={subtitle} icon="Users">
        {available && people.length > 0 && (
          <Button
            variant={selecting ? 'primary' : 'secondary'}
            size="sm"
            icon={selecting ? 'X' : 'ListChecks'}
            disabled={busy}
            onClick={() => {
              setSelecting(!selecting);
              setChosen([]);
            }}
          >
            {selecting ? 'Done' : 'Select'}
          </Button>
        )}
        {available && stats.faces > 0 && (
          <>
            <Button
              variant="secondary"
              size="sm"
              icon="RefreshCw"
              disabled={busy}
              onClick={() => void regroup()}
            >
              Regroup
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="ScanFace"
              disabled={busy}
              onClick={() => void scan()}
            >
              Look for faces
            </Button>
          </>
        )}
      </PageHeader>

      {status === 'loading' && people.length === 0 ? (
        <PeopleSkeleton />
      ) : !available ? (
        <Card>
          <div className="flex flex-col items-start gap-4 p-5">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
              <Icon name="ScanFace" size={20} strokeWidth={1.7} />
            </span>
            <div>
              <h2 className="text-section font-semibold text-ink">
                {error ? 'The people in this archive could not be read' : 'Face grouping is not set up yet'}
              </h2>
              <p className="mt-1 max-w-[520px] text-meta leading-relaxed text-ink-2">
                {error
                  ? `The index did not answer: ${error}`
                  : `${reason ?? 'The face models are not installed.'} They are two small ONNX files — a detector and a recogniser — that run on this computer, on your own photographs. Nothing is uploaded and no name is ever generated for you: the app groups faces and you decide who they are.`}
              </p>
              {cost !== null && (
                <p className="mt-2 text-2xs text-ink-3">
                  About {cost} MB to download, once, into{' '}
                  <span className="font-mono">{models?.directory ?? 'your app data folder'}</span>.
                </p>
              )}
            </div>
            {/* Deliberately not disabled when the service is not answering yet:
                the download command reports that clearly, whereas a greyed-out
                button would leave the user with no way to find out why. */}
            <Button
              variant="primary"
              size="sm"
              icon="Download"
              disabled={busy}
              onClick={() => void installModels()}
            >
              {cost !== null ? `Download \u00b7 ${cost} MB` : 'Download face models'}
            </Button>
          </div>
        </Card>
      ) : people.length === 0 ? (
        <EmptyState
          icon="ScanFace"
          title="No faces found yet"
          description={
            stats.faces === 0
              ? 'The models are ready. Look through the photographs already indexed and group the faces they contain — this runs locally and can be paused from the status bar.'
              : 'Nothing to show.'
          }
          actionLabel="Look for faces"
          onAction={() => void scan()}
        />
      ) : (
        <>
          {available && stats.unnamed > 0 && !selecting && (
            <NameReviewPrompt people={people} onOpen={() => setReviewOpen(true)} />
          )}

          <PeopleViews
            people={people}
            busy={busy}
            selecting={selecting}
            selected={chosen}
            onOpen={openPerson}
            onRename={(personId, label) => void rename(personId, label)}
            onForget={setTarget}
            onToggle={(personId) =>
              setChosen((current) =>
                current.includes(personId)
                  ? current.filter((id) => id !== personId)
                  : [...current, personId],
              )
            }
          />

          {selecting ? (
            <div className="sticky bottom-2 z-20 flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-soft">
              <span className="text-meta text-ink-2">
                {chosen.length === 0
                  ? 'Pick two or more groups that are the same person.'
                  : `${formatCount(chosen.length)} selected`}
              </span>
              <span className="flex-1" />
              {chosen.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setChosen([])}>
                  Clear
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                icon="Combine"
                disabled={busy || chosen.length < 2}
                onClick={() => setConfirmMerge(true)}
              >
                Merge {chosen.length >= 2 ? formatCount(chosen.length) : ''} groups
              </Button>
            </div>
          ) : (
            <p className="px-1 text-2xs text-ink-3">
              {formatCount(stats.people)} {stats.people === 1 ? 'person' : 'people'} from{' '}
              {formatCount(stats.faces)} {stats.faces === 1 ? 'face' : 'faces'} in{' '}
              {formatCount(stats.photos)} photographs. Names are stored in your archive, not online.
            </p>
          )}
        </>
      )}

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        className="max-w-[440px]"
      >
        <div className="p-5">
          <h2 className="text-section font-semibold text-ink">
            Delete {target?.label ?? 'this group'}?
          </h2>
          <p className="mt-2 text-meta leading-relaxed text-ink-2">
            The group and the{' '}
            {formatCount(target?.faceCount ?? 0)} faces behind it are removed from the index.
            Your photographs are never touched — nothing is moved, renamed or deleted on disk.
          </p>
          <p className="mt-2 text-meta leading-relaxed text-ink-2">
            This one is permanent: a face pass skips photographs it has already looked at, so
            the group cannot reassemble itself. To get it back you would have to rescan the
            folder it came from.
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setTarget(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon="Trash2"
              disabled={busy}
              onClick={() => {
                const doomed = target;
                setTarget(null);
                if (doomed) void forget(doomed.id);
              }}
            >
              Delete group
            </Button>
          </div>
        </div>
      </Modal>

      {/*
        The merge, confirmed before anything moves.

        Two questions are answered here: which group survives (its name is the
        one that carries), and that this is what the user meant — several faces
        look alike, and folding them together is invisible afterwards without an
        undo, which the notice after the merge provides.
      */}
      <Modal
        open={confirmMerge}
        onClose={() => setConfirmMerge(false)}
        className="max-w-[460px]"
      >
        <div className="p-5">
          <h2 className="text-section font-semibold text-ink">
            Merge {formatCount(chosen.length)} groups into one?
          </h2>
          <p className="mt-2 text-meta leading-relaxed text-ink-2">
            Every photograph in these groups ends up under one name, and searching for that name
            finds all of them. Nothing on disk is moved, renamed or deleted.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {chosen
              .map((id) => people.find((person) => person.id === id))
              .filter((person): person is Person => Boolean(person))
              .map((person) => (
                <span
                  key={person.id}
                  className="inline-flex items-center gap-2 rounded-pill border border-line bg-surface-2 py-1 pl-1 pr-2.5"
                >
                  <span className="block h-6 w-6 overflow-hidden rounded-full border border-line bg-surface-2">
                    <AssetImage path={person.coverPath} alt="" fallbackIcon="User" />
                  </span>
                  <span className="text-2xs text-ink-2">{person.label ?? 'Unnamed group'}</span>
                </span>
              ))}
          </div>

          <p className="mt-3 text-2xs leading-relaxed text-ink-3">
            The groups you picked are folded into{' '}
            <span className="font-medium text-ink-2">{mergeSurvivor?.label ?? 'the first group'}</span>
            {mergeSurvivor?.label ? ', which keeps its name' : ''}. You can undo this straight
            afterwards from the notice at the bottom of the screen.
          </p>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmMerge(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="Combine"
              disabled={busy || !mergeSurvivor}
              onClick={() => {
                const survivor = mergeSurvivor;
                setConfirmMerge(false);
                setSelecting(false);
                const ids = chosen;
                setChosen([]);
                if (survivor) void mergeMany(ids, survivor.id);
              }}
            >
              Merge them
            </Button>
          </div>
        </div>
      </Modal>

      <NameReview
        open={reviewOpen}
        people={people}
        onClose={() => setReviewOpen(false)}
      />
    </Page>
  );
}
