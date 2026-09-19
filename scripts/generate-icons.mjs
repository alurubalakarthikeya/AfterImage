#!/usr/bin/env node
/**
 * AfterImage icon generator.
 *
 * Draws the application mark procedurally and encodes real PNG and ICO files
 * with nothing but Node's zlib — no image toolchain, no binary assets checked
 * into the repository, and the icon can never drift from the in-app logo.
 *
 *   node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'src-tauri', 'icons');

/* -------------------------------------------------------------------------- */
/* PNG encoding                                                               */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* The mark                                                                   */
/* -------------------------------------------------------------------------- */

const BG = [0xdc, 0xef, 0xed];
const ACCENT = [0x2f, 0x77, 0x73];

/** Signed distance to a rounded rectangle centred on (cx, cy). */
function roundedRectDistance(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius);
  const dy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Coverage of a stroke along a distance field, antialiased over one pixel. */
const strokeCoverage = (distance, thickness) => clamp(0.5 - (Math.abs(distance) - thickness / 2), 0, 1);
const fillCoverage = (distance) => clamp(0.5 - distance, 0, 1);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function mix(base, over, alpha) {
  return [
    Math.round(over[0] * alpha + base[0] * (1 - alpha)),
    Math.round(over[1] * alpha + base[1] * (1 - alpha)),
    Math.round(over[2] * alpha + base[2] * (1 - alpha)),
  ];
}

/**
 * Render the logo at a given size.
 *
 * Three offset apertures, the innermost filled — the same motif as
 * `LogoMark`, drawn from the same geometry so they stay in step.
 */
function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 3; // supersampling per axis
  const unit = size / 32; // geometry is authored on a 32×32 grid

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = (x + (sx + 0.5) / samples) / unit;
          const py = (y + (sy + 0.5) / samples) / unit;

          const corner = roundedRectDistance(px, py, 16, 16, 15.4, 15.4, 9);
          let coverage = fillCoverage(corner);
          let colour = BG;

          if (coverage > 0) {
            // Nested square outlines, then the solid centre.
            const outer = roundedRectDistance(px, py, 13.5, 13.5, 6, 6, 3.5);
            const inner = roundedRectDistance(px, py, 17, 17, 6, 6, 3.5);
            const core = roundedRectDistance(px, py, 20, 20, 5.5, 5.5, 3.5);

            const outerEdge = strokeCoverage(outer, 1.6);
            const innerEdge = strokeCoverage(inner, 1.6);
            const coreFill = fillCoverage(core);

            colour = mix(colour, ACCENT, outerEdge * 0.45);
            colour = mix(colour, ACCENT, innerEdge * 0.75);
            colour = mix(colour, ACCENT, coreFill);
          }

          r += colour[0] * coverage;
          g += colour[1] * coverage;
          b += colour[2] * coverage;
          a += coverage;
        }
      }

      const total = samples * samples;
      const alpha = a / total;
      const offset = (y * size + x) * 4;
      // Un-premultiply so edge pixels keep their colour at partial alpha.
      const divisor = alpha > 0 ? a : 1;
      rgba[offset] = Math.round(r / divisor) || 0;
      rgba[offset + 1] = Math.round(g / divisor) || 0;
      rgba[offset + 2] = Math.round(b / divisor) || 0;
      rgba[offset + 3] = Math.round(alpha * 255);
    }
  }

  return encodePng(size, size, rgba);
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

const targets = [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
  ['icon.png', 512],
];

for (const [name, size] of targets) {
  const png = renderIcon(size);
  writeFileSync(join(outDir, name), png);
  console.log(`icons/${name}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB`);
}

const ico = encodeIco(
  [16, 32, 48, 128, 256].map((size) => ({ size, png: renderIcon(size) })),
);
writeFileSync(join(outDir, 'icon.ico'), ico);
console.log(`icons/icon.ico  multi-size  ${(ico.length / 1024).toFixed(1)} kB`);

// macOS wants an .icns; Tauri can generate it from icon.png, but a bundle
// built without one still runs. Point the developer at the right command.
console.log('\nWrote icons to src-tauri/icons. For an .icns (macOS), run: npm run tauri icon');
