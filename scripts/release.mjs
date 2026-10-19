#!/usr/bin/env node
/**
 * Put the installers where the website can serve them.
 *
 *   node scripts/release.mjs [--dry-run] [--use-existing]
 *
 * The landing page offers the Windows installer, and the link is relative —
 * `<site>/downloads/AfterImage-setup.exe` — so what has to be true for it to
 * work is that that file sits beside the page that links it. That is the whole
 * job of this file: build, find what the build produced, and copy it into
 * `public/downloads` under a name that never changes. `vite build` then carries
 * it into `dist/`, which is the folder that gets deployed.
 *
 * The alternative was a release on a code host, and it was worse in three ways:
 * the download needed the repository to be public and reachable from wherever
 * the page was opened, the page and the artifact could be published at
 * different times, and the link pointed away from the build sitting next to it.
 * The version belongs to the build; the filename belongs to the link.
 *
 * One command is the whole deployment. Pass `--use-existing` to stage whatever
 * is already built (a rebuild you ran yourself, or a re-publish of the same
 * bits) instead of building again.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const useExisting = process.argv.includes('--use-existing');

/**
 * What the page links to, and where the build leaves it.
 *
 * The search is a glob rather than a fixed path because Tauri's bundler names
 * the installer after the product and the version. Whatever is newest and
 * matches is the artifact.
 */
const ASSETS = [
  {
    name: 'AfterImage-setup.exe',
    label: 'Windows installer',
    from: 'src-tauri/target/release/bundle/nsis',
    match: (file) => file.toLowerCase().endsWith('.exe'),
    hint: 'npm run tauri:build',
  },
];

/**
 * Two destinations, for two different readers.
 *
 * `public/downloads` is what `npm run dev` serves and what every build copies
 * into `dist` — the site's own copy of the file. `dist/downloads` is what a
 * deployment serves, written here *after* the desktop build has run: the
 * application embeds `dist`, so an installer sitting there during the build
 * would be packed inside the installer (`vite.config.ts` drops it from the
 * build output for exactly that reason).
 */
const STAGING = 'public/downloads';
const BUILD_OUTPUT = 'dist/downloads';

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
    let mtime = 0;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      mtime = 0;
    }
    if (!best || mtime > best.mtime) best = { path, mtime };
  }
  return best;
}

/**
 * Build what this release is about to carry, from the sources as they are now.
 *
 * The Windows installer is not optional: it is the artifact the page's download
 * button points at, and publishing a leftover from an earlier build is the one
 * failure this script exists to prevent.
 */
/**
 * Freeze the local indexer, when this machine has the tools for it.
 *
 * The installer ships the indexing service as a bundled resource. Without it a
 * machine still has the archive — the index, the thumbnails, the search — but
 * not OCR, visual labels, embeddings or faces, because those live in the Python
 * service. That is the difference between the application and a file browser,
 * so the attempt is made here, before the installer is built, and its absence
 * is said out loud rather than discovered by a user whose photographs never get
 * tags.
 *
 * It is attempted rather than required because freezing needs PyInstaller in
 * the service's virtual environment, and a developer without it should still be
 * able to publish the desktop build.
 */
function buildIndexer() {
  const marker = join(
    root,
    'src-tauri',
    'resources',
    'indexer',
    process.platform === 'win32' ? 'afterimage-indexer.exe' : 'afterimage-indexer',
  );
  if (existsSync(marker)) {
    console.log('· indexer: an executable is already staged beside the app');
    return;
  }
  console.log('\nFreezing the local indexer into the installer…');
  try {
    execFileSync('node', [join('scripts', 'service.mjs'), 'build'], {
      cwd: root,
      stdio: 'inherit',
    });
    if (!existsSync(marker)) throw new Error('the build produced no executable');
    console.log('· indexer: bundled');
  } catch {
    console.warn('· indexer: NOT bundled — this installer will rely on a Python service on the machine.');
    console.warn(
      '  Run `npm run service:install` and `npm run service:build`, then build again to ship it.',
    );
  }
}

function buildArtifacts() {
  buildIndexer();
  console.log('\nBuilding the Windows installer from the current sources…');
  execFileSync('npm', ['run', 'tauri:build'], {
    cwd: root,
    stdio: 'inherit',
    // `npm` is `npm.cmd` on Windows and `execFileSync` will not resolve a `.cmd`
    // through `PATH` without a shell.
    shell: process.platform === 'win32',
  });
}

if (!dryRun && !useExisting) buildArtifacts();

const found = ASSETS.map((asset) => ({
  ...asset,
  source: newest(join(root, asset.from), asset.match)?.path ?? null,
})).filter((asset) => {
  if (asset.source) return true;
  const line = `· ${asset.label}: not built — skipping (${asset.hint})`;
  if (asset.optional) console.warn(line);
  else console.error(line);
  return false;
});

if (!found.some((asset) => !asset.optional)) {
  console.error('\nNothing to stage. Build the app first, then run this again.');
  process.exit(1);
}

console.log(`\nStaging ${found.length} artifact${found.length === 1 ? '' : 's'} into ${STAGING}`);
for (const asset of found) console.log(`  ${asset.label}: ${asset.source} → ${asset.name}`);

if (dryRun) {
  console.log('\n--dry-run: nothing was copied.');
  process.exit(0);
}

for (const target of [STAGING, BUILD_OUTPUT]) {
  if (target === BUILD_OUTPUT && !existsSync(join(root, 'dist'))) continue;
  const directory = join(root, target);
  mkdirSync(directory, { recursive: true });
  for (const asset of found) {
    copyFileSync(asset.source, join(directory, asset.name));
  }
  console.log(`  copied into ${target}`);
}

console.log('\nDone. The page now serves this, from its own folder:');
for (const asset of ASSETS) {
  console.log(`  /downloads/${asset.name}`);
}
console.log(
  '\nDeploy the folder that holds the site (dist/) and the downloads go with it — no second upload.',
);
