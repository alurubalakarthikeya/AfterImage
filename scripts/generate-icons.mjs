#!/usr/bin/env node
/**
 * AfterImage desktop icon generator.
 *
 *   node scripts/generate-icons.mjs
 *
 * Draws the application icon from `public/after-image-logo.png` — the same
 * artwork the wordmark, the favicon, the manifest icons and the maskable
 * home-screen icon all come from — and writes the PNGs and the `.ico` that
 * `tauri.conf.json` bundles into the Windows executable.
 *
 * It used to draw a procedural mark of three offset apertures from hard-coded
 * geometry. That mark was the original logo, and the artwork in `public/` has
 * moved on since: the executable was shipping an icon the rest of the
 * application no longer used, which is exactly the stale-packaging failure this
 * file exists to prevent. There is now one source of truth — the logo file — and
 * the desktop icon, the window, the taskbar, the installer and the Start-menu
 * entry all follow it by regenerating this.
 *
 * Ground colour is measured, not chosen. The artwork is a gradient that runs
 * from near-white to near-black, so any light ground swallows the bright end of
 * it: on the old light-teal tile 29% of the mark's pixels were within a few
 * shades of the background and vanished, against 0.3% on black. Black is also
 * what the maskable home-screen icon already uses (`generate-web-icons.mjs`),
 * so the executable and the installed web app now present the same tile.
 *
 * Uses nothing but Node's zlib — no image toolchain, no binary assets checked
 * into the repository.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The encoder and the resampler are shared with the home-screen icon
// generator, so the two can never disagree about what a PNG is.
import { alphaBounds, decodePng, encodePng, overCanvas, resample } from './lib/raster.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'src-tauri', 'icons');
const source = join(root, 'public', 'after-image-logo.png');

/**
 * The tile the mark sits on.
 *
 * Black, for the reason measured above. Windows paints it behind the mark in
 * the taskbar, the window, the Alt-Tab switcher and Explorer, and it never
 * masks it away the way a launcher does — so what is drawn here is what is
 * shown, corner included.
 */
const GROUND = [0x00, 0x00, 0x00];

/**
 * How much of the tile the mark fills.
 *
 * Slightly inside the safe circle a launcher would crop to, so the same
 * artwork survives both. A mark that touches its own edge reads as a cropped
 * picture rather than as an icon.
 */
const FILL = 0.78;

/** Rounded-square radius as a fraction of the tile — the shape of a modern app icon. */
const CORNER = 0.22;

const artwork = decodePng(readFileSync(source));
const bounds = alphaBounds(artwork);

console.log(
  `source  after-image-logo.png  ${artwork.width}×${artwork.height}` +
    `  mark ${bounds.width}×${bounds.height} at ${bounds.x},${bounds.y}`,
);

/** Fit the mark into a box, keeping its proportions. */
function fit(box) {
  const scale = Math.min(box / bounds.width, box / bounds.height);
  return {
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale)),
  };
}

/** Anti-aliased coverage of the rounded-square mask at a pixel centre. */
function cornerCoverage(x, y, size) {
  const radius = size * CORNER;
  const half = size / 2;
  const dx = Math.abs(x + 0.5 - half) - (half - radius);
  const dy = Math.abs(y + 0.5 - half) - (half - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const distance = outside + Math.min(Math.max(dx, dy), 0) - radius;
  return Math.min(Math.max(0.5 - distance, 0), 1);
}

/** One icon: the mark, centred on its black rounded tile. */
function render(size) {
  const target = fit(size * FILL);
  const mark = resample(artwork, bounds, target.width, target.height);
  const painted = overCanvas(size, GROUND, mark).rgba;

  // Round the tile's corners after compositing, so the mark is clipped by the
  // same shape as the background rather than overflowing a mask it cannot see.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const coverage = cornerCoverage(x, y, size);
      const alpha = (painted[(y * size + x) * 4 + 3] * coverage) | 0;
      painted[(y * size + x) * 4 + 3] = alpha;
    }
  }

  return encodePng(size, size, painted);
}

/* -------------------------------------------------------------------------- */
/* ICO container (PNG-compressed entries, supported since Windows Vista)      */
/* -------------------------------------------------------------------------- */

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;

  entries.forEach((entry, index) => {
    const at = index * 16;
    directory[at] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 2] = 0; // palette
    directory[at + 3] = 0; // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

/* -------------------------------------------------------------------------- */

mkdirSync(outDir, { recursive: true });

// The sizes `tauri.conf.json` names, plus the two Windows asks for at runtime.
const targets = [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
  ['icon.png', 512],
];

for (const [name, size] of targets) {
  const png = render(size);
  writeFileSync(join(outDir, name), png);
  console.log(`icons/${name.padEnd(16)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB`);
}

const ico = encodeIco(
  [16, 32, 48, 128, 256].map((size) => ({ size, png: render(size) })),
);
writeFileSync(join(outDir, 'icon.ico'), ico);
console.log(`icons/icon.ico  multi-size  ${(ico.length / 1024).toFixed(1)} kB`);

// macOS wants an .icns; Tauri can generate it from icon.png, but a bundle
// built without one still runs. Point the developer at the right command.
console.log('\nWrote icons to src-tauri/icons. For an .icns (macOS), run: npm run tauri icon');
