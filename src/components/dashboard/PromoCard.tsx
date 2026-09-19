import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { cn, formatBytes, formatCount, formatRelativeTime } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

/**
 * The index panel.
 *
 * This slot used to sell the product to the person who already owns it. It now
 * reports the four facts a user of a local index actually wants: how much is
 * indexed, what is still queued, which folders are watched, and when the archive
 * was last read. Everything is read from the index; nothing is asserted.
 */
export function PromoCard({ className }: { className?: string }) {
  const navigate = useUIStore((state) => state.navigate);
  const folders = useArchiveStore((state) => state.folders);
  const totals = useArchiveStore((state) => state.totals);
  const storage = useArchiveStore((state) => state.storage);
  const index = useArchiveStore((state) => state.index);

  const watched = folders.filter((folder) => folder.watched).length;
  const queued = index.pending + index.processing;

  const rows: Array<{ label: string; value: string; problem?: boolean }> = [
    { label: 'Indexed', value: `${formatCount(totals.files)} files` },
    { label: 'Queue', value: queued > 0 ? `${formatCount(queued)} waiting` : 'Empty' },
    { label: 'Watched folders', value: `${formatCount(watched)}` },
    {
      label: 'Failed',
      value: index.failed > 0 ? formatCount(index.failed) : 'None',
      problem: index.failed > 0,
    },
    {
      label: 'Last scan',
      value: index.lastScanAt ? formatRelativeTime(index.lastScanAt) : 'Not yet',
    },
  ];

  return (
    <section
      className={cn('rounded-card border border-line bg-surface p-4', className)}
      aria-label="Local index"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-body font-semibold text-ink">Local index</h2>
        <span className="inline-flex items-center gap-1 text-2xs text-ink-3">
          <Icon name="HardDrive" size={11} strokeWidth={2} />
          This device
        </span>
      </div>

      <dl className="mt-3 divide-y divide-line">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-2xs text-ink-3">{row.label}</dt>
            <dd
              className={cn(
                'truncate text-2xs tabular-nums',
                row.problem ? 'text-critical' : 'text-ink-2',
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {storage.usedBytes > 0 && (
        <p className="mt-2 text-2xs text-ink-3">
          {formatBytes(storage.usedBytes)} of your files measured on disk
        </p>
      )}

      {index.problem && (
        <p className="mt-2 flex items-start gap-1.5 text-2xs leading-relaxed text-caution">
          <Icon name="Info" size={11} strokeWidth={2.2} className="mt-0.5 shrink-0" />
          {index.problem}
        </p>
      )}

      <button
        type="button"
        onClick={() => navigate('settings')}
        className="mt-3 inline-flex items-center gap-1.5 text-2xs font-medium text-accent-ink underline-offset-4 hover:underline"
      >
        Manage watch folders
        <Icon name="ArrowRight" size={11} strokeWidth={2.2} />
      </button>
    </section>
  );
}
