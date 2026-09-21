import { useEffect, useState } from 'react';
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
import { PeopleSkeleton, PeopleViews } from '@/components/people/PeopleViews';

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
  const openPerson = useUIStore((state) => state.openPerson);

  // Deleting a group is irreversible in a way the other actions on this page
  // are not, so it is the one thing here that asks first.
  const [target, setTarget] = useState<Person | null>(null);

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

  return (
    <Page>
      <PageHeader title="People" subtitle={subtitle} icon="Users">
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
          <PeopleViews
            people={people}
            busy={busy}
            onOpen={openPerson}
            onRename={(personId, label) => void rename(personId, label)}
            onForget={setTarget}
          />
          <p className="px-1 text-2xs text-ink-3">
            {formatCount(stats.people)} {stats.people === 1 ? 'person' : 'people'} from{' '}
            {formatCount(stats.faces)} {stats.faces === 1 ? 'face' : 'faces'} in{' '}
            {formatCount(stats.photos)} photographs. Names are stored in your archive, not online.
          </p>
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
    </Page>
  );
}
