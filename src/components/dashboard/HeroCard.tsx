import { useMemo } from 'react';
import { useArchiveStore } from '@/stores/archive';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { cn, dateParts, formatBytes, formatCount, greeting } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

/**
 * The hero.
 *
 * This was a photograph placeholder; now it is the archive itself — how much is
 * indexed, when it was last read, and what is still in the queue. The date
 * lockup stays: a local archive is about when things happened to you.
 *
 * The wash behind it is a flat tint, not an image, because inventing a scenic
 * photograph for a screen about the user's actual files would be a lie told in
 * decoration.
 */
export function HeroCard({ className }: { className?: string }) {
  const totals = useArchiveStore((state) => state.totals);
  const storage = useArchiveStore((state) => state.storage);
  const index = useArchiveStore((state) => state.index);
  const folders = useArchiveStore((state) => state.folders);
  const userName = useSettingsStore((state) => state.userName);
  const navigate = useUIStore((state) => state.navigate);

  const now = useMemo(() => new Date(), []);
  const date = useMemo(() => dateParts(now), [now]);
  const watched = folders.filter((folder) => folder.watched).length;

  return (
    <section
      className={cn(
        'relative h-[250px] overflow-hidden rounded-card-lg border border-line',
        className,
      )}
      aria-label="Archive summary"
      style={{
        background:
          'linear-gradient(140deg, #12302e 0%, #1b4542 42%, #2f7773 100%)',
      }}
    >
      {/* Date lockup */}
      <div className="absolute right-6 top-5 text-right text-white">
        <div className="flex items-start justify-end gap-1.5">
          <span className="mt-1 text-[11px] font-semibold tracking-[0.16em] text-white/60">
            {date.month}
          </span>
          <span
            className="text-[34px] font-semibold leading-none tracking-[-0.04em]"
            style={{ fontStretch: 'condensed' }}
          >
            {date.day}
          </span>
        </div>
        <div className="mt-1 text-meta text-white/55">
          {date.weekday}, {date.year}
        </div>
      </div>

      <div className="relative flex h-full flex-col justify-end p-6">
        <p className="text-meta text-white/60">{greeting(now)},</p>
        <h1
          className="mt-0.5 text-hero font-[650] tracking-[-0.02em] text-white"
          style={{ fontVariationSettings: '"wght" 650' }}
        >
          {userName}
        </h1>

        {totals.files === 0 ? (
          <div className="mt-3">
            <p className="max-w-[420px] text-meta leading-relaxed text-white/70">
              Nothing indexed yet. Choose the folders that hold your screenshots, photos and
              documents — AfterImage reads them where they are and never moves a file.
            </p>
            <button
              type="button"
              onClick={() => navigate('settings')}
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-btn border border-white/25 bg-white/12 px-3 text-meta font-medium text-white transition-colors duration-150 hover:bg-white/20"
            >
              <Icon name="FolderPlus" size={14} strokeWidth={2} />
              Add a folder
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-meta text-white/80">
            <span className="tabular-nums">{formatCount(totals.files)} files</span>
            <span className="h-1 w-1 rounded-full bg-white/40" aria-hidden="true" />
            <span className="tabular-nums text-white">
              {formatCount(totals.newToday)} added today
            </span>
            <span className="h-1 w-1 rounded-full bg-white/40" aria-hidden="true" />
            <button
              type="button"
              onClick={() => navigate('all')}
              className="inline-flex items-center gap-1 text-white/85 underline-offset-4 transition-colors duration-150 hover:text-white hover:underline"
            >
              Open the archive
              <Icon name="ArrowRight" size={12} strokeWidth={2.2} />
            </button>
          </div>
        )}

        <p className="mt-4 text-meta leading-relaxed text-white/45">
          {storage.indexedFiles > 0
            ? `${formatBytes(storage.usedBytes)} across ${watched} watched ${watched === 1 ? 'folder' : 'folders'} · ${
                index.state === 'indexing' ? `indexing ${formatCount(index.pending + index.processing)} now` : 'up to date'
              }`
            : 'Everything is processed on this machine. Nothing is uploaded, ever.'}
        </p>
      </div>
    </section>
  );
}
