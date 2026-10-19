/**
 * The installer this site offers.
 *
 * `npm run release` copies the installer the build just produced to
 * `public/downloads/AfterImage-setup.exe`, so the page and the file it offers
 * are published together — one deployment carries both, and there is no second
 * service to keep in step. The link is relative, so a build served from
 * anywhere, including a subpath, links to its own copy.
 *
 * There used to be an Android entry here as well. Nothing ever built one, so
 * the page spent its first paint asking the server whether a file existed and
 * then saying it did not. A download list of one is a download button.
 */

export const WINDOWS_RELEASE = {
  /** What the user calls the device, not what the format is called. */
  label: 'Windows',
  /** The file, in the words a person choosing between two files would use. */
  detail: '.exe · 64-bit · Windows 10 and later',
  /** Path under the site root; the name `scripts/release.mjs` stages under. */
  file: 'downloads/AfterImage-setup.exe',
} as const;

/**
 * The URL for the installer.
 *
 * `BASE_URL` rather than a leading slash, so a deployment under a subpath —
 * `/afterimage/` — links to its own copy rather than to the domain root.
 */
export function downloadUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.endsWith('/') ? base : `${base}/`}${WINDOWS_RELEASE.file}`;
}
