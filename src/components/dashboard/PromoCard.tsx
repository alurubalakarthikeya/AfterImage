import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { cn, formatCount } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

/**
 * Product philosophy card.
 *
 * It used to carry a scenic image; now it carries the facts about where the
 * user's data actually lives, read from the index. The claims are checkable:
 * files indexed, folders watched, and whether the local model is running.
 */
export function PromoCard({ className }: { className?: string }) {
  const navigate = useUIStore((state) => state.navigate);
  const folders = useArchiveStore((state) => state.folders);
  const totals = useArchiveStore((state) => state.totals);
  const index = useArchiveStore((state) => state.index);

  const facts = [
    {
      icon: 'HardDrive',
      label: folders.length === 0 ? 'No folders watched yet' : `${formatCount(folders.length)} folders watched`,
      detail: `${formatCount(totals.files)} files indexed on this device`,
    },
    {
      icon: 'Lock',
      label: 'Local only',
      detail: 'No upload, no account, no telemetry',
    },
    {
      icon: 'Cpu',
      label: index.problem ? 'Models unavailable' : 'On-device processing',
      detail: index.problem ?? 'OCR and embeddings run in a local service',
    },
  ];

  return (
    <section
      className={cn('rounded-card-lg border border-line bg-surface p-4', className)}
      aria-label="About AfterImage"
    >
      <div className="flex items-center gap-2 text-2xs text-ink-3">
        <Icon name="Shield" size={12} strokeWidth={2} />
        Private · Local · Yours
      </div>

      <h2 className="mt-2 text-[17px] font-semibold leading-snug tracking-[-0.02em] text-ink">
        Your memories, beautifully organized.
      </h2>

      <ul className="mt-3 flex flex-col gap-2">
        {facts.map((fact) => (
          <li key={fact.label} className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent-softer text-accent-ink">
              <Icon name={fact.icon} size={11} strokeWidth={1.9} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-2xs font-medium text-ink-2">{fact.label}</span>
              <span className="block truncate text-2xs text-ink-3">{fact.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => navigate('settings')}
        className="mt-3 inline-flex items-center gap-1.5 rounded-btn border border-line-strong px-3 py-1.5 text-meta font-medium text-ink transition-colors duration-150 hover:bg-surface-3"
      >
        Manage folders
        <Icon name="ArrowRight" size={12} strokeWidth={2.2} />
      </button>
    </section>
  );
}
