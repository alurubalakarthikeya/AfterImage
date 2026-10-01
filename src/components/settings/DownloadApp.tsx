import { isTauri } from '@/services/host';
import {
  RELEASE_TARGETS,
  downloadUrl,
  releasesAvailable,
  releasesPageUrl,
  type ReleaseTarget,
} from '@/utils/releases';
import { Row, Section } from '@/components/common/Section';
import { Icon } from '@/components/common/Icon';

/**
 * The installer, offered from inside the browser build.
 *
 * The web build is a real archive — it reads the folders you grant it and keeps
 * the index in this browser — but it is still a page something else is hosting.
 * The two downloads here are the same application as an installed program: it
 * reads the disk itself, it owns its own storage, it starts without a browser
 * and it keeps working when the network is gone. Showing them where the web
 * build is running is the only place a visitor can find that out.
 *
 * Where the buttons point is deliberately boring. They are stable links to the
 * newest release (`src/utils/releases.ts`), so a new build never means new links
 * and there is nothing to update here at deployment time — the release script
 * publishes the artifact once under a name that does not change.
 *
 * The desktop build renders nothing: it is already the thing being offered.
 */
function DownloadButton({ target }: { target: ReleaseTarget }) {
  return (
    // An anchor rather than a button, because this is a download: it has to be
    // right-clickable, saveable, and openable in a new tab by the browser's own
    // affordances. The classes are the secondary button's, so the two sit
    // together in one visual language.
    <a
      href={downloadUrl(target)}
      rel="noreferrer"
      className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-meta font-medium text-ink shadow-soft transition-[background-color,border-color,color] duration-150 hover:border-line-strong hover:bg-surface-2"
    >
      <Icon name="Download" size={14} strokeWidth={2} />
      Download
    </a>
  );
}

export function DownloadApp() {
  if (isTauri()) return null;
  // A fork with no repository of its own has nowhere honest to point.
  if (!releasesAvailable()) return null;

  return (
    <Section
      icon="Download"
      title="Download the app"
      description="The same archive as an installed program: it reads your folders directly, keeps everything on this machine, and opens without a browser."
    >
      {RELEASE_TARGETS.map((target) => (
        <Row key={target.id} label={target.label} hint={target.detail}>
          <DownloadButton target={target} />
        </Row>
      ))}

      <p className="flex items-start gap-2 text-2xs leading-relaxed text-ink-3">
        <Icon name="Info" size={12} strokeWidth={2} className="mt-px shrink-0" />
        <span>
          These always point at the newest build — there is no version to pick and nothing to
          update by hand.{' '}
          <a
            href={releasesPageUrl()}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent-ink hover:underline"
          >
            See every release
          </a>
          .
        </span>
      </p>
    </Section>
  );
}
