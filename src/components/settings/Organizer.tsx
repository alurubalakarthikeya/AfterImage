import { useState } from 'react';
import type { OrganizePlan, OrganizeReport } from '@/types';
import { getHost, isTauri } from '@/services/host';
import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { cn, formatCount, formatStorage } from '@/utils/format';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Overlay';
import { Row, Section } from '@/components/common/Section';

/** How many individual moves the preview lists before it stops. */
const SAMPLE = 60;

function MoveList({ plan }: { plan: OrganizePlan }) {
  const moves = plan.moves.slice(0, SAMPLE);
  return (
    <ul className="flex flex-col">
      {moves.map((move) => (
        <li
          key={move.fileId}
          className="flex items-start gap-2 border-b border-line py-2 text-2xs last:border-b-0"
        >
          <Icon name="ArrowRight" size={12} strokeWidth={2} className="mt-0.5 shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-ink-2" title={move.from}>
              {move.from}
            </span>
            <span className="block truncate font-mono text-ink" title={move.to}>
              {move.to}
            </span>
            {move.collections > 1 && (
              <span className="mt-0.5 block text-[10px] text-ink-3">
                in {move.collections} collections — filed under the first
              </span>
            )}
          </span>
        </li>
      ))}
      {plan.moves.length > moves.length && (
        <li className="pt-2 text-2xs text-ink-3">
          and {formatCount(plan.moves.length - moves.length)} more
        </li>
      )}
    </ul>
  );
}

/**
 * Filing the disk the way the archive already has it filed.
 *
 * This is the one control in the application that moves the user's own files, so
 * it is built around one idea: nothing happens until a person has seen exactly
 * what will happen. The plan is read first, always — the number of files, the
 * bytes, the folders that will be created and the files that are being left
 * alone, each with its reason — and it is recomputed when it is applied, so what
 * was shown is what runs.
 *
 * A file the user has put in a collection goes under that collection, inside its
 * kind; everything else goes to `Unfiled`. One file, one home: copying a
 * photograph into three folders would triple the disk cost of the same pixels.
 */
export function Organizer() {
  const host = getHost();
  const refresh = useArchiveStore((state) => state.refresh);
  const totals = useArchiveStore((state) => state.totals);
  const pushNotice = useUIStore((state) => state.pushNotice);

  const [destination, setDestination] = useState('');
  const [plan, setPlan] = useState<OrganizePlan | null>(null);
  const [report, setReport] = useState<OrganizeReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const canMove = isTauri();

  const choose = async () => {
    setBusy(true);
    try {
      const picked = await host.pickOrganizeDestination();
      if (picked) {
        setDestination(picked);
        setPlan(null);
        setReport(null);
      }
    } catch (error) {
      pushNotice({ level: 'error', message: error instanceof Error ? error.message : 'Could not use that folder.' });
    } finally {
      setBusy(false);
    }
  };

  const readPlan = async (): Promise<OrganizePlan | null> => {
    setBusy(true);
    try {
      const next = await host.organizePlan(destination);
      setPlan(next);
      return next;
    } catch (error) {
      pushNotice({ level: 'error', message: error instanceof Error ? error.message : 'The plan could not be read.' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    const next = await readPlan();
    if (next) setPreviewing(true);
  };

  const apply = async () => {
    setBusy(true);
    try {
      const result = await host.organizeApply(destination);
      setReport(result);
      setPlan(result.plan);
      setConfirming(false);
      setPreviewing(false);
      await refresh();
      const failed = result.failed.length;
      pushNotice({
        level: failed > 0 ? 'warn' : 'success',
        message:
          failed > 0
            ? `Filed ${result.moved} files. ${failed} could not be moved — see the list below.`
            : `Filed ${result.moved} files into ${formatCount(result.folders.length)} folders.`,
      });
    } catch (error) {
      pushNotice({ level: 'error', message: error instanceof Error ? error.message : 'The files could not be filed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section
        icon="FolderTree"
        title="Organizing your files"
        description="AfterImage is a view of your disk, and your disk is not a view of AfterImage. This files your photographs the way the archive already has them filed — one folder per kind, one folder per collection — so the two agree without you moving anything by hand."
      >
        <Row
          label="Destination"
          hint="A folder for AfterImage to file into. It becomes part of the archive, so what is moved stays indexed."
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'max-w-[280px] truncate font-mono text-2xs',
                destination ? 'text-ink-2' : 'text-ink-3',
              )}
              title={destination || undefined}
            >
              {destination || 'No folder chosen'}
            </span>
            <Button
              variant="secondary"
              size="sm"
              icon="FolderOpen"
              disabled={!canMove || busy}
              onClick={() => void choose()}
            >
              Choose…
            </Button>
          </div>
        </Row>

        <Row
          label="Preview before moving"
          hint={
            canMove
              ? `Collections decide the folder. Anything you have not grouped goes to Unfiled. ${formatCount(totals.files)} files are indexed.`
              : 'Moving files into place is part of the desktop build — a web page cannot write to your folders.'
          }
        >
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon="Eye"
              disabled={!canMove || !destination || busy}
              onClick={() => void preview()}
            >
              Preview plan
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="FolderTree"
              disabled={!canMove || !destination || busy || (plan?.moves.length ?? 0) === 0}
              onClick={() => setConfirming(true)}
            >
              File my files
            </Button>
          </div>
        </Row>

        {plan && !report && (
          <div className="rounded-card border border-line bg-surface-2 p-3 text-2xs leading-relaxed text-ink-2">
            <span className="font-medium text-ink">{formatCount(plan.moves.length)} files</span> would move,{' '}
            {formatStorage(plan.totalBytes)} in total, into {formatCount(plan.folders.length)} folders.{' '}
            {plan.settled > 0 && `${formatCount(plan.settled)} are already where they belong. `}
            {plan.skipped.length > 0 && `${formatCount(plan.skipped.length)} will be left alone.`}
          </div>
        )}

        {report && (
          <div className="rounded-card border border-line bg-surface-2 p-3 text-2xs leading-relaxed text-ink-2">
            <span className="font-medium text-ink">{formatCount(report.moved)} files filed.</span>{' '}
            {report.folders.map((folder) => (
              <span key={folder} className="mr-2 inline-block font-mono text-[10px] text-ink-3">
                {folder}
              </span>
            ))}
            {report.skipped.length > 0 && <div className="mt-1">{report.skipped.length} changed while filing.</div>}
            {report.failed.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5">
                {report.failed.slice(0, 5).map((entry) => (
                  <li key={entry.fileId} className="truncate text-critical">
                    {entry.name}: {entry.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>

      <Modal open={previewing} onClose={() => setPreviewing(false)} className="max-w-[720px]">
        <div className="flex max-h-[70vh] flex-col p-5">
          <h2 className="text-section font-semibold text-ink">What would move</h2>
          <p className="mt-1 text-meta leading-relaxed text-ink-2">
            Into <span className="font-mono text-2xs">{plan?.root}</span>. Nothing is copied and nothing is
            overwritten: a name already taken gains a number beside it.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-3">
            <span>{formatCount(plan?.moves.length ?? 0)} files</span>
            <span>{formatStorage(plan?.totalBytes ?? 0)}</span>
            <span>{formatCount(plan?.folders.length ?? 0)} folders created</span>
            {plan?.settled ? <span>{formatCount(plan.settled)} already in place</span> : null}
          </div>

          {plan && plan.folders.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {plan.folders.map((folder) => (
                <span
                  key={folder}
                  className="rounded-pill border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-2"
                >
                  {folder}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-card border border-line bg-surface p-3">
            {plan && plan.moves.length > 0 ? (
              <MoveList plan={plan} />
            ) : (
              <p className="py-6 text-center text-meta text-ink-3">
                Every file is already where it belongs.
              </p>
            )}
            {plan && plan.skipped.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="text-2xs font-medium text-ink-2">Left alone</div>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {plan.skipped.slice(0, 8).map((entry) => (
                    <li key={entry.fileId} className="truncate text-2xs text-ink-3">
                      {entry.name} — {entry.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPreviewing(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="FolderTree"
              disabled={(plan?.moves.length ?? 0) === 0}
              onClick={() => {
                setPreviewing(false);
                setConfirming(true);
              }}
            >
              File my files
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={confirming} onClose={() => setConfirming(false)} className="max-w-[460px]">
        <div className="p-5">
          <h2 className="text-section font-semibold text-ink">
            Move {formatCount(plan?.moves.length ?? 0)} files?
          </h2>
          <p className="mt-2 text-meta leading-relaxed text-ink-2">
            This moves your files on disk, into{' '}
            <span className="font-mono text-2xs">{plan?.root}</span>. AfterImage keeps every file's
            name and contents exactly as they are, and nothing is deleted. If you move something back
            later, the archive follows it.
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" icon="FolderTree" disabled={busy} onClick={() => void apply()}>
              Move them
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
