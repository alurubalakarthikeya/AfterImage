/**
 * Where the installers live: this deployment's own folder.
 *
 * `npm run release` copies the installers the build just produced into
 * `public/downloads`, so the page and the files it offers are published
 * together — one deployment carries both, and there is no second service to
 * keep in step. That is why the links are relative: a build is served from
 * wherever it was deployed, and `<site>/downloads/AfterImage-setup.exe` is
 * beside it either way.
 *
 * What this replaced: every link pointed at GitHub's
 * `releases/latest/download/<name>` path. That made the download depend on a
 * repository being public, having been released, and being reachable from
 * wherever the page was opened — and it meant a deployment could ship a page
 * whose buttons led somewhere other than the build sitting next to it.
 */

export interface ReleaseTarget {
  id: 'windows' | 'android';
  /** What the user calls the device, not what the format is called. */
  label: string;
  /** The file, in the words a person choosing between two files would use. */
  detail: string;
  /** Path under the site root; the name `scripts/release.mjs` stages under. */
  file: string;
  icon: string;
}

export const RELEASE_TARGETS: ReleaseTarget[] = [
  {
    id: 'windows',
    label: 'Windows',
    detail: 'Installer (.exe) · 64-bit · Windows 10 and later',
    file: 'downloads/AfterImage-setup.exe',
    icon: 'Monitor',
  },
  {
    id: 'android',
    label: 'Android',
    detail: 'Package (.apk) · Android 8 and later',
    file: 'downloads/AfterImage.apk',
    icon: 'Smartphone',
  },
];

/**
 * The URL for one installer.
 *
 * `BASE_URL` rather than a leading slash, so a deployment under a subpath —
 * `/afterimage/` — links to its own copy rather than to the domain root.
 */
export function downloadUrl(target: ReleaseTarget): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.endsWith('/') ? base : `${base}/`}${target.file}`;
}

/**
 * Which installers this deployment actually has.
 *
 * There is no way to know from the bundle: the same page is deployed with and
 * without the artifacts, depending on whether a desktop build ran before it was
 * published. So each file is asked for, and a row is only offered when the
 * answer is the file itself.
 *
 * `text/html` is treated as missing on purpose. A static host with a
 * single-page-app fallback answers every unknown path with the site's own
 * `index.html` and a cheerful 200, which would otherwise turn "we never built
 * an Android package" into a download button that saves a web page.
 *
 * A request that fails outright counts as present: the failure that must never
 * happen is hiding an installer that is really there because the network was
 * busy for a moment.
 */
export async function probeInstallers(): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    RELEASE_TARGETS.map(async (target) => {
      try {
        const response = await fetch(downloadUrl(target), {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
          cache: 'no-store',
        });
        // The body is not wanted — only the headers are; this releases the
        // connection rather than reading a five-megabyte installer.
        try {
          await response.body?.cancel();
        } catch {
          /* nothing to release */
        }
        const type = response.headers.get('content-type') ?? '';
        const missing = response.status === 404 || type.includes('text/html');
        return [target.id, !missing] as const;
      } catch {
        return [target.id, true] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}
