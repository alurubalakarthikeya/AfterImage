import { useEffect, useState } from 'react';
import {
  RELEASE_TARGETS,
  downloadUrl,
  probeInstallers,
  type ReleaseTarget,
} from '@/utils/releases';
import { Icon } from '@/components/common/Icon';
import { Logo } from '@/components/common/Logo';

/**
 * The website.
 *
 * This is what the browser build *is*: one page, one panel, and the two
 * installers beside it in the same folder. Nothing else — no archive, no
 * navigation, no empty state that would ask a visitor to hand a web page a
 * folder so it can pretend to be the application. Everything the archive does
 * needs the program, and the program is one click away; a page that imitated
 * the parts it can reach would only be a worse version of the thing it is
 * offering.
 *
 * The desktop build never renders this. Opening the installed application shows
 * the archive, and `App` decides that before anything here is mounted.
 */
function DownloadRow({ target, ready }: { target: ReleaseTarget; ready: boolean | null }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-ink-2">
          <Icon name={target.icon} size={17} strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <div className="text-body font-medium text-ink">{target.label}</div>
          <div className="truncate text-2xs text-ink-3">{target.detail}</div>
        </div>
      </div>

      {ready === null ? (
        // Deliberately not a button yet: offering a download before knowing
        // whether the file is there is how a page ends up pointing at nothing.
        <span className="shrink-0 text-2xs text-ink-3">Checking…</span>
      ) : ready ? (
        <a
          href={downloadUrl(target)}
          // A real anchor rather than a scripted download: it has to be
          // right-clickable, resumable and openable in a new tab, which is what
          // the browser's own download machinery already does properly.
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-ink px-3.5 text-meta font-medium text-canvas transition-opacity duration-150 hover:opacity-90"
        >
          <Icon name="Download" size={14} strokeWidth={2.2} />
          Download
        </a>
      ) : (
        <span className="shrink-0 text-2xs text-ink-3">Not published yet</span>
      )}
    </div>
  );
}

export function Landing() {
  const [available, setAvailable] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void probeInstallers().then((result) => {
      if (!cancelled) setAvailable(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    // `af-ambient` is the wash the glass refracts; without it the panel below
    // is a white rectangle on a white page. Same canvas as the application, so
    // the two share one look.
    <div className="af-ambient flex min-h-full flex-col items-center justify-center bg-canvas px-6 py-14">
      <main className="w-full max-w-[560px]">
        <Logo size="lg" className="items-start" />

        {/* The words above the panel: what this is, and the one promise that
            distinguishes it from every other way of keeping files. */}
        <h1 className="mt-6 text-title font-semibold leading-tight tracking-[-0.02em] text-ink">
          Your archive, on your own machine
        </h1>
        <p className="mt-3 text-body leading-relaxed text-ink-2">
          AfterImage reads the folders you choose and makes everything in them
          findable — by name, by the text inside a screenshot, and by what is in
          the picture. No account, no upload, and nothing is ever moved.
        </p>

        <section className="glass mt-8 rounded-panel border border-line p-5">
          <h2 className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
            Download
          </h2>
          <div className="mt-1">
            {RELEASE_TARGETS.map((target) => (
              <DownloadRow key={target.id} target={target} ready={available?.[target.id] ?? null} />
            ))}
          </div>
          <p className="mt-4 flex items-start gap-2 text-2xs leading-relaxed text-ink-3">
            <Icon name="Shield" size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span>
              The installers are served from this site, beside the page you are reading — they are
              the files the build produced, not a copy kept somewhere else.
            </span>
          </p>
        </section>

        <p className="mt-5 text-2xs text-ink-3">
          Version {__BUILD_VERSION__} · built {new Date(__BUILD_TIME__).toLocaleDateString()}
        </p>
      </main>
    </div>
  );
}
