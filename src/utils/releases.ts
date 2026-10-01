/**
 * Where the installers live.
 *
 * Every link points at GitHub's `releases/latest/download/<name>` path, which
 * always resolves to the newest published release. That is the whole design: a
 * build is published once, by `npm run release`, under a name that never
 * changes, and every link written today keeps working for every build after it.
 * No version is baked into a URL, and nothing has to be re-uploaded or re-edited
 * when the application is deployed again.
 *
 * The asset names are fixed for the same reason the links are. The version
 * belongs to the release tag, not to the filename, so `AfterImage-setup.exe` is
 * replaced in place by each release rather than accumulating a folder of
 * versioned copies that the interface would have to know about.
 */

/** Substituted at build time from `package.json`; empty when it has no repository. */
const REPO = typeof __RELEASE_REPO__ === 'string' ? __RELEASE_REPO__ : '';

export interface ReleaseTarget {
  id: 'windows' | 'android';
  /** What the user calls the device, not what the format is called. */
  label: string;
  /** The file, in the words a person choosing between two files would use. */
  detail: string;
  /** The asset name `scripts/release.mjs` publishes under. */
  asset: string;
  icon: string;
}

export const RELEASE_TARGETS: ReleaseTarget[] = [
  {
    id: 'windows',
    label: 'Windows',
    detail: 'Installer (.exe) · 64-bit · Windows 10 and later',
    asset: 'AfterImage-setup.exe',
    icon: 'Monitor',
  },
  {
    id: 'android',
    label: 'Android',
    detail: 'Package (.apk) · Android 8 and later',
    asset: 'AfterImage.apk',
    icon: 'Smartphone',
  },
];

/**
 * True when the installers can be offered at all.
 *
 * A fork with no repository of its own has nowhere to point, and a download
 * button that leads to a 404 is worse than no button — so the interface asks
 * this first rather than assuming the links resolve.
 */
export function releasesAvailable(): boolean {
  return REPO.length > 0;
}

export function downloadUrl(target: ReleaseTarget): string {
  return `https://github.com/${REPO}/releases/latest/download/${target.asset}`;
}

/** Where a user can see what changed, and find every older build. */
export function releasesPageUrl(): string {
  return `https://github.com/${REPO}/releases`;
}
