import { downloadUrl, WINDOWS_RELEASE } from '@/utils/releases';
import { Icon } from '@/components/common/Icon';
import { Logo } from '@/components/common/Logo';

/**
 * The website.
 *
 * This is what the browser build *is*: a page, a sentence about what the
 * program does, and the installer beside it in the same folder. Nothing else —
 * no archive, no navigation, no empty state that would ask a visitor to hand a
 * web page a folder so it can pretend to be the application.
 *
 * The download is one quiet line rather than a panel of platforms. There is
 * exactly one build, and a card listing it — with a spinner while a probe asks
 * whether the file exists, and a second row for a package that was never made —
 * gave a one-click download the visual weight of a store. It is a link with a
 * version under it.
 *
 * The desktop build never renders this. Opening the installed application shows
 * the archive, and `App` decides that before anything here is mounted.
 */
export function Landing() {
  return (
    // `af-ambient-quiet` rather than the shell's own wash: that one is strong
    // enough for panels to refract, and this page has none — over a download
    // button it only made the canvas look grey. Same palette, two corners.
    <div className="af-ambient-quiet flex min-h-full flex-col bg-canvas px-6">
      <main className="mx-auto flex w-full max-w-[600px] flex-1 flex-col justify-center py-20">
        <Logo size="lg" className="items-start" />

        {/* The words above the link: what this is, and the one promise that
            distinguishes it from every other way of keeping files. */}
        <h1 className="mt-7 text-title font-semibold leading-tight tracking-[-0.02em] text-ink">
          Your archive, on your own machine
        </h1>
        <p className="mt-3 max-w-[520px] text-body leading-relaxed text-ink-2">
          AfterImage reads the folders you choose and makes everything in them findable — by name,
          by the text inside a screenshot, and by what is in the picture. No account, no upload,
          and nothing is ever moved.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <a
            href={downloadUrl()}
            // A real anchor rather than a scripted download: it has to be
            // right-clickable, resumable and openable in a new tab, which is
            // what the browser's own download machinery already does properly.
            className="inline-flex h-11 items-center gap-2.5 rounded-full bg-ink pl-4 pr-5 text-meta font-medium text-canvas transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Icon name="Download" size={15} strokeWidth={2.2} />
            Download for {WINDOWS_RELEASE.label}
          </a>
          <span className="text-2xs tabular-nums text-ink-3">Version {__BUILD_VERSION__}</span>
        </div>

        <p className="mt-3 text-2xs leading-relaxed text-ink-3">{WINDOWS_RELEASE.detail}</p>

        <p className="mt-8 flex items-start gap-2 border-t border-line pt-4 text-2xs leading-relaxed text-ink-3">
          <Icon name="Shield" size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
          <span>
            Served from this site, beside the page you are reading. The installer runs entirely on
            your machine; your folders are only ever read.
          </span>
        </p>
      </main>
    </div>
  );
}
