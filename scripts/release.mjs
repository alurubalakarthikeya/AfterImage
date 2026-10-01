#!/usr/bin/env node
/**
 * Publish the installers, under names that never change.
 *
 *   node scripts/release.mjs [--dry-run]
 *
 * The web build offers the Windows installer and the Android package to whoever
 * opens it, and both links point at `releases/latest/download/<name>` — so what
 * has to be true for them to work is that every release carries the artifacts
 * under exactly those two names. That is the whole job of this file. It finds
 * what the build produced, copies it aside under the stable name, and uploads it
 * to the release for the current version.
 *
 * The alternative is remembering, once per deployment, to rename a
 * `AfterImage_0.1.2_x64-setup.exe` to `AfterImage-setup.exe` by hand in a browser
 * — which is the kind of thing that is right the first time and wrong the third.
 * The version belongs to the tag; the filename belongs to the link.
 *
 * Requires the GitHub CLI (`gh auth login` once). Run `npm run tauri:build`
 * first, and `npm run icons:web` before that if the artwork changed.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version ?? '0.0.0';
const tag = `v${version}`;
const dryRun = process.argv.includes('--dry-run');

/**
 * What the interface links to, and where the build leaves it.
 *
 * The search is a glob rather than a fixed path because Tauri's bundler names
 * the installer after the product and the version, and the Android output moves
 * between `universal` and an ABI-named directory depending on how it was built.
 * Whatever is newest and matches is the artifact.
 */
const ASSETS = [
  {
    name: 'AfterImage-setup.exe',
    label: 'Windows installer',
    from: 'src-tauri/target/release/bundle/nsis',
    match: (file) => file.toLowerCase().endsWith('.exe'),
    hint: 'npm run tauri:build',
  },
  {
    name: 'AfterImage.apk',
    label: 'Android package',
    from: 'src-tauri/gen/android/app/build/outputs/apk',
    match: (file) => file.toLowerCase().endsWith('.apk'),
    hint: 'npm run tauri -- android build',
  },
];

function repoFrom(manifest) {
  const url =
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  const match = typeof url === 'string' ? url.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/i) : null;
  return match ? match[1] : '';
}

/** Newest matching file under a directory, searched to a shallow depth. */
function newest(dir, match, depth = 4) {
  if (!existsSync(dir) || depth < 0) return null;
  let best = null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = newest(path, match, depth - 1);
      if (nested && (!best || nested.mtime > best.mtime)) best = nested;
      continue;
    }
    if (!match(entry.name)) continue;
    // The build stamps the artifact when it writes it, so the newest one is the
    // one that was just produced — which is the answer to "which file did I
    // mean" that a fixed filename cannot give.
    const mtime = (() => {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return 0;
      }
    })();
    if (!best || mtime > best.mtime) best = { path, mtime };
  }
  return best;
}

function gh(args) {
  execFileSync('gh', args, { cwd: root, stdio: 'inherit' });
}

const repo = repoFrom(pkg);
if (!repo) {
  console.error('package.json has no GitHub repository — nothing to publish to.');
  process.exit(1);
}

const found = ASSETS.map((asset) => ({
  ...asset,
  source: newest(join(root, asset.from), asset.match)?.path ?? null,
})).filter((asset) => {
  if (asset.source) return true;
  console.warn(`· ${asset.label}: not built — skipping (${asset.hint})`);
  return false;
});

if (found.length === 0) {
  console.error('\nNothing to publish. Build the app first, then run this again.');
  process.exit(1);
}

console.log(`Publishing ${found.length} artifact${found.length === 1 ? '' : 's'} to ${repo} @ ${tag}`);
for (const asset of found) console.log(`  ${asset.label}: ${asset.source} → ${asset.name}`);

if (dryRun) {
  console.log('\n--dry-run: the release was not touched.');
  process.exit(0);
}

try {
  execFileSync('gh', ['--version'], { stdio: 'ignore' });
} catch {
  console.error(
    '\nThe GitHub CLI (`gh`) was not found. Install it, run `gh auth login`, then run this again.',
  );
  process.exit(1);
}

// The release is created once per version and then added to, so re-running this
// after a rebuild replaces the asset instead of failing on an existing tag.
let exists = true;
try {
  execFileSync('gh', ['release', 'view', tag, '--repo', repo], { cwd: root, stdio: 'ignore' });
} catch {
  exists = false;
}

if (!exists) {
  gh([
    'release',
    'create',
    tag,
    '--repo',
    repo,
    '--title',
    `AfterImage ${version}`,
    '--notes',
    `AfterImage ${version}. The installer and the Android package below are the same two links the web build always points at, so they are always the newest build.`,
  ]);
}

// Staged under the stable name: the asset takes the name of the file it was
// uploaded from, which is how the fixed link is kept fixed.
const staging = join(tmpdir(), 'afterimage-release');
mkdirSync(staging, { recursive: true });

for (const asset of found) {
  const staged = join(staging, asset.name);
  copyFileSync(asset.source, staged);
  gh(['release', 'upload', tag, staged, '--repo', repo, '--clobber']);
}

console.log('\nDone. The links the web build uses now resolve to this build:');
for (const asset of ASSETS) {
  console.log(`  https://github.com/${repo}/releases/latest/download/${asset.name}`);
}
