import { useMemo } from 'react';
import { useArchiveStore } from '@/stores/archive';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { getHost } from '@/services/host';
import { useHeroImage } from '@/hooks/useHeroImage';
import { cn, dateParts, formatBytes, formatCount, greeting } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

/**
 * The header of the dashboard.
 *
 * The photograph is one of the user's own — the best landscape the index could
 * find, shown from the preview Rust wrote for it. When there is no suitable
 * photograph the card is a flat brand tint, because decorating a screen about
 * someone's own files with an image they do not own is a lie told in
 * decoration.
 *
 * The type is deliberately modest: this is a dashboard header, not a hero
 * banner. It greets, it states the size of the archive, and it gets out of the
 * way of the files below it.
 */
export function HeroCard({ className }: { className?: string }) {
  const totals = useArchiveStore((state) => state.totals);
  const storage = useArchiveStore((state) => state.storage);
  const index = useArchiveStore((state) => state.index);
  const folders = useArchiveStore((state) => state.folders);
  const userName = useSettingsStore((state) => state.userName);
  const navigate = useUIStore((state) => state.navigate);
  const select = useUIStore((state) => state.selectFile);

  const hero = useHeroImage();
  const heroSrc = hero?.previewPath ? getHost().assetUrl(hero.previewPath) : null;

  const now = useMemo(() => new Date(), []);
  const date = useMemo(() => dateParts(now), [now]);
  const watched = folders.filter((folder) => folder.watched).length;
  const name = userName.trim();
  const queued = index.pending + index.processing;

  return (
    <section
      className={cn(
        'relative h-[188px] overflow-hidden rounded-card-lg border border-line',
        className,
      )}
      aria-label="Library summary"
      style={
        heroSrc
          ? undefined
          : { background: 'linear-gradient(150deg, #10151c 0%, #17293f 58%, #1d4b7a 100%)' }
      }
    >
      {heroSrc && (
        <>
          <img
            src={heroSrc}
            alt=""
            aria-hidden="true"
            draggable={false}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* One scrim, shaped so the type keeps its contrast whatever the
              photograph happens to be doing behind it. */}
          <span
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(96deg, rgba(7,11,16,0.92) 0%, rgba(7,11,16,0.72) 46%, rgba(7,11,16,0.34) 76%, rgba(7,11,16,0.54) 100%)',
            }}
          />
        </>
      )}

      {/* Date lockup, small enough to read as a calendar, not a poster. */}
      <div className="absolute right-5 top-4 text-right text-white/85">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
          {date.month}
        </div>
        <div className="text-[19px] font-semibold leading-tight tabular-nums">{date.day}</div>
        <div className="text-[11px] text-white/45">
          {date.weekday}, {date.year}
        </div>
      </div>

      <div className="relative flex h-full flex-col justify-end p-5">
        <h1 className="text-hero font-semibold tracking-[-0.02em] text-white">
          {greeting(now)}
          {name ? `, ${name}` : ''}
        </h1>

        {totals.files === 0 ? (
          <p className="mt-1.5 max-w-[440px] text-meta leading-relaxed text-white/65">
            Nothing indexed yet. Choose the folders that hold your screenshots, photos and
            documents — AfterImage reads them where they are and never moves a file.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-white/70">
            <span className="tabular-nums">{formatCount(totals.files)} files indexed</span>
            <span className="h-3 w-px bg-white/20" aria-hidden="true" />
            <span className="tabular-nums">{formatCount(totals.newToday)} added today</span>
            <span className="h-3 w-px bg-white/20" aria-hidden="true" />
            <span className="tabular-nums">
              {formatBytes(storage.usedBytes)} across {watched} watched{' '}
              {watched === 1 ? 'folder' : 'folders'}
            </span>
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-white/45">
          <span>
            {queued > 0
              ? `Indexing ${formatCount(queued)} file${queued === 1 ? '' : 's'} in the background`
              : index.failed > 0
                ? `${formatCount(index.failed)} file${index.failed === 1 ? '' : 's'} could not be processed`
                : totals.files === 0
                  ? 'Everything is processed on this machine. Nothing is uploaded.'
                  : 'Index up to date'}
          </span>
          <button
            type="button"
            onClick={() => navigate('settings')}
            className="inline-flex items-center gap-1 underline-offset-4 transition-colors duration-150 hover:text-white/80 hover:underline"
          >
            Manage watch folders
            <Icon name="ArrowRight" size={10} strokeWidth={2.2} />
          </button>
          {/* Which of their own photographs is on screen, and a way into it. */}
          {hero && (
            <button
              type="button"
              onClick={() => select(hero.id)}
              title={hero.path}
              className="max-w-[260px] truncate underline-offset-4 transition-colors duration-150 hover:text-white/80 hover:underline"
            >
              Cover: {hero.generatedTitle ?? hero.name}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
