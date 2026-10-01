/**
 * A very small raster toolkit, built on Node's own zlib.
 *
 * AfterImage has no image toolchain and no binary assets in the repository: the
 * desktop icons are drawn procedurally by `generate-icons.mjs`, and the
 * home-screen icons are resampled from the artwork in `public/` by
 * `generate-web-icons.mjs`. Both need the same two things — encode a PNG, and
 * read one — so they live here rather than being written twice, which is how a
 * decoder and an encoder drift apart.
 *
 * Scope, deliberately: 8-bit non-interlaced grayscale/RGB/RGBA PNGs, all five
 * filter types, and area-average resampling with premultiplied alpha. That is
 * everything this repository's own images use and nothing more.
 */

import { deflateSync, inflateSync } from 'node:zlib';

/* -------------------------------------------------------------------------- */
/* PNG: encoding                                                              */
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

/**
 * Encode straight RGBA bytes as a PNG.
 *
 * Written with filter 0 on every row: the rows here are drawn rather than
 * photographed, and the deflate that follows finds the structure for free.
 */
export function encodePng(width, height, rgba) {
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
/* PNG: decoding                                                              */
/* -------------------------------------------------------------------------- */

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Read a PNG into straight (non-premultiplied) RGBA bytes. */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      channels = CHANNELS[data[9]];
      if (depth !== 8) throw new Error(`unsupported bit depth: ${depth}`);
      if (!channels) throw new Error('unsupported colour type');
      if (data[12] !== 0) throw new Error('interlaced PNGs are not supported');
    }
    if (type === 'IDAT') parts.push(data);
    if (type === 'IEND') break;

    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = Buffer.alloc(stride);

    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? row[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      const value = line[i];
      let restored;

      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          restored = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          throw new Error(`unknown filter type: ${filter}`);
      }

      row[i] = restored & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      if (channels === 1) {
        rgba[to] = row[from];
        rgba[to + 1] = row[from];
        rgba[to + 2] = row[from];
        rgba[to + 3] = 255;
      } else if (channels === 2) {
        rgba[to] = row[from];
        rgba[to + 1] = row[from];
        rgba[to + 2] = row[from];
        rgba[to + 3] = row[from + 1];
      } else if (channels === 3) {
        rgba[to] = row[from];
        rgba[to + 1] = row[from + 1];
        rgba[to + 2] = row[from + 2];
        rgba[to + 3] = 255;
      } else {
        rgba[to] = row[from];
        rgba[to + 1] = row[from + 1];
        rgba[to + 2] = row[from + 2];
        rgba[to + 3] = row[from + 3];
      }
    }

    previous = row;
  }

  return { width, height, rgba };
}

/* -------------------------------------------------------------------------- */
/* Raster operations                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The rectangle a transparent image actually occupies.
 *
 * Both the artwork and the procedural mark are drawn with a transparent margin
 * around them, and a margin is not something the eye measures against — an icon
 * built from the whole canvas is smaller and off-centre than the same icon built
 * from the mark.
 */
export function alphaBounds(image, threshold = 16) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.rgba[(y * image.width + x) * 4 + 3] < threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return { x: 0, y: 0, width: image.width, height: image.height };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Area-average resample.
 *
 * Averaging in premultiplied space, then un-premultiplying, is what keeps the
 * soft edge of a mark from picking up a dark fringe: a red pixel of 20% alpha is
 * not red, and averaging it as if it were stains every edge pixel it touches.
 */
export function resample(image, box, width, height) {
  const out = Buffer.alloc(width * height * 4);
  const scaleX = box.width / width;
  const scaleY = box.height / height;

  for (let y = 0; y < height; y += 1) {
    const y0 = box.y + y * scaleY;
    const y1 = y0 + scaleY;
    for (let x = 0; x < width; x += 1) {
      const x0 = box.x + x * scaleX;
      const x1 = x0 + scaleX;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let total = 0;

      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        const coverY = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (coverY <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const coverX = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (coverX <= 0) continue;

          const from = (Math.min(sy, image.height - 1) * image.width + Math.min(sx, image.width - 1)) * 4;
          const weight = coverX * coverY;
          const alpha = (image.rgba[from + 3] / 255) * weight;

          r += image.rgba[from] * alpha;
          g += image.rgba[from + 1] * alpha;
          b += image.rgba[from + 2] * alpha;
          a += alpha;
          total += weight;
        }
      }

      const to = (y * width + x) * 4;
      if (a > 0) {
        out[to] = Math.round(r / a);
        out[to + 1] = Math.round(g / a);
        out[to + 2] = Math.round(b / a);
      }
      out[to + 3] = total > 0 ? Math.round((a / total) * 255) : 0;
    }
  }

  return { width, height, rgba: out };
}

/** Draw `image` over a solid background, centred in a square canvas. */
export function overCanvas(size, background, image) {
  const out = Buffer.alloc(size * size * 4);
  if (background) {
    const [r, g, b] = background;
    for (let i = 0; i < size * size; i += 1) {
      out[i * 4] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = 255;
    }
  }

  const left = Math.round((size - image.width) / 2);
  const top = Math.round((size - image.height) / 2);

  for (let y = 0; y < image.height; y += 1) {
    const dy = top + y;
    if (dy < 0 || dy >= size) continue;
    for (let x = 0; x < image.width; x += 1) {
      const dx = left + x;
      if (dx < 0 || dx >= size) continue;

      const from = (y * image.width + x) * 4;
      const to = (dy * size + dx) * 4;
      const alpha = image.rgba[from + 3] / 255;
      if (alpha <= 0) continue;

      out[to] = Math.round(image.rgba[from] * alpha + out[to] * (1 - alpha));
      out[to + 1] = Math.round(image.rgba[from + 1] * alpha + out[to + 1] * (1 - alpha));
      out[to + 2] = Math.round(image.rgba[from + 2] * alpha + out[to + 2] * (1 - alpha));
      out[to + 3] = Math.round(Math.max(out[to + 3], alpha * 255));
    }
  }

  return { width: size, height: size, rgba: out };
}
