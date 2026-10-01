#!/usr/bin/env node
/**
 * AfterImage home-screen icons.
 *
 * The installable build needs PNG renditions of the artwork at the sizes a phone
 * asks for, and — for Android — a *maskable* one: an icon whose important
 * content survives whatever shape the launcher crops it to. Neither can be
 * produced by `generate-icons.mjs`, which draws the desktop mark procedurally.
 *
 * So this resamples `public/after-image-logo.png`, the same file the wordmark
 * and the tab icon come from, and writes into `public/` beside it:
 *
 *   icon-192.png            any         the manifest's small icon
 *   icon-512.png            any         the manifest's large icon, and what
 *                                       install prompts and stores show
 *   icon-maskable-512.png   maskable    full-bleed, safe-zone content
 *   apple-touch-icon.png    iOS         what "Add to Home Screen" puts under
 *                                       the icon on an iPhone or an iPad
 *
 * The artwork is transparent and has a margin of its own, so both renditions are
 * built from the mark's measured bounds rather than the canvas: a margin inside
 * the artwork plus a margin inside the icon is two margins, and the result reads
 * as an icon that is too small.
 *
 *   node scripts/generate-web-icons.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alphaBounds, decodePng, encodePng, overCanvas, resample } from './lib/raster.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'public');
const source = join(outDir, 'after-image-logo.png');

/**
 * How much of the square the mark fills when the platform draws the icon as it
 * is. Not 100%: a mark that touches its own edge reads as a cropped picture
 * rather than as an icon, and every platform pads anyway.
 */
const ANY_FILL = 0.86;

/**
 * The same, for iOS.
 *
 * A hair smaller, because an iOS icon is masked to a squircle whose corners cut
 * further in than a plain square would. Apple's own guidance is the same shape
 * of advice as Android's: keep what matters away from the edge, and — unlike
 * Android — paint the whole tile, because iOS does not put transparency on a
 * background of its own choosing so much as leave it black.
 */
const TOUCH_FILL = 0.84;

/**
 * How much of the square the mark fills when the platform is going to crop it.
 *
 * The maskable safe zone is the circle inscribed in the middle 80% of the icon —
 * everything outside it may be cut to a circle, a squircle or a teardrop. The
 * mark is wider than it is tall, so the constraint that bites is its diagonal:
 * sizing it until that diagonal fits inside the safe circle is the difference
 * between the icon surviving a round launcher and losing its corners to one.
 */
const MASKABLE_SAFE_ZONE = 0.8;

/**
 * What a maskable or home-screen icon's background is for.
 *
 * A maskable icon must have no transparency: whatever shows through belongs to
 * the launcher, and an unpainted tile is a mark floating on an unknown colour.
 * This is the application's own dark canvas — pure black — which is also the
 * ground the artwork reads best against (measured: its opaque pixels average
 * 158 luminance, so black is the far side of it and the mark's highlights stay
 * highlights rather than dissolving into white).
 */
const MASKABLE_BACKGROUND = [0x00, 0x00, 0x00];

const artwork = decodePng(readFileSync(source));
const bounds = alphaBounds(artwork);

console.log(
  `source  after-image-logo.png  ${artwork.width}×${artwork.height}` +
    `  mark ${bounds.width}×${bounds.height} at ${bounds.x},${bounds.y}`,
);

/** Fit the mark into a box, keeping its proportions. */
function fit(width, height, box) {
  const scale = Math.min(box / width, box / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The platform draws this one as it is, so it is the mark and nothing else. */
function renderAny(size) {
  const target = fit(bounds.width, bounds.height, size * ANY_FILL);
  const mark = resample(artwork, bounds, target.width, target.height);
  return encodePng(size, size, overCanvas(size, null, mark).rgba);
}

/** Fully painted, so the platform masks a tile rather than a floating mark. */
function renderTouch(size) {
  const target = fit(bounds.width, bounds.height, size * TOUCH_FILL);
  const mark = resample(artwork, bounds, target.width, target.height);
  return encodePng(size, size, overCanvas(size, MASKABLE_BACKGROUND, mark).rgba);
}

/**
 * The platform crops this one, so it fills its square and keeps its content
 * inside the safe circle.
 */
function renderMaskable(size) {
  const scale = (size * MASKABLE_SAFE_ZONE) / Math.hypot(bounds.width, bounds.height);
  const mark = resample(
    artwork,
    bounds,
    Math.max(1, Math.round(bounds.width * scale)),
    Math.max(1, Math.round(bounds.height * scale)),
  );
  return encodePng(size, size, overCanvas(size, MASKABLE_BACKGROUND, mark).rgba);
}

const outputs = [
  ['icon-192.png', 192, renderAny],
  ['icon-512.png', 512, renderAny],
  ['icon-maskable-512.png', 512, renderMaskable],
  ['apple-touch-icon.png', 180, renderTouch],
];

for (const [name, size, render] of outputs) {
  const png = render(size);
  writeFileSync(join(outDir, name), png);
  console.log(`public/${name.padEnd(22)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
