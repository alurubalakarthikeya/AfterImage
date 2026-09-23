import type { DnaColor } from '@/types';

/**
 * Pixels, in the browser.
 *
 * Three jobs, all of them the ones the Rust side does on the desktop: shrink a
 * photograph into a thumbnail, measure what it is made of, and hand the renderer
 * a URL it can put in an `<img>`.
 *
 * The measurements deliberately mirror `src-tauri/src/dna.rs` — same analysis
 * size, same Rec. 709 luma, same histogram-then-one-k-means palette, same
 * Laplacian variance for detail. Two builds that disagree about what "high
 * contrast" means would be two products, and the numbers here are shown to the
 * user as facts about their picture.
 */

/** Longest edge the measurement is taken at. Same as the desktop build. */
const ANALYSIS_EDGE = 320;
const PALETTE_SIZE = 6;
const MERGE_DISTANCE = 72;
const CANDIDATES = 400;
const MINIMUM_SHARE = 0.005;
const SHARPNESS_REFERENCE = 600;
const TEMPERATURE_THRESHOLD = 0.04;

/** Longest edge of a generated thumbnail, and of the larger presentation copy. */
export const THUMB_EDGE = 512;
export const PREVIEW_EDGE = 1600;

export interface Analysis {
  palette: DnaColor[];
  brightness: number;
  contrast: number;
  sharpness: number;
  saturation: number;
  temperatureShift: number;
}

export function temperature(shift: number): 'warm' | 'neutral' | 'cool' {
  if (shift > TEMPERATURE_THRESHOLD) return 'warm';
  if (shift < -TEMPERATURE_THRESHOLD) return 'cool';
  return 'neutral';
}

function isImage(blob: Blob): boolean {
  return blob.type.startsWith('image/');
}

/** Decode a blob, or answer `null` for anything this browser cannot read. */
async function decode(blob: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/**
 * Draw a decoded picture onto a canvas at most `edge` pixels on its long side.
 *
 * Never scaled *up*: a 90-pixel icon asked to fit 512 would be resampled into a
 * blurry mess that is larger on disk than the original.
 */
function drawTo(bitmap: ImageBitmap, edge: number): HTMLCanvasElement {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context) {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
  }
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

export interface Generated {
  thumb: Blob;
  preview: Blob;
  width: number;
  height: number;
  analysis: Analysis;
}

/**
 * Everything the archive wants to know about one photograph, from one decode.
 *
 * The full size comes from the bitmap rather than from the file, because that is
 * the number the browser can actually confirm — the alternative is guessing from
 * a header this code does not parse.
 */
export async function generate(blob: Blob): Promise<Generated | null> {
  if (!isImage(blob)) return null;
  const bitmap = await decode(blob);
  if (!bitmap) return null;

  try {
    const small = drawTo(bitmap, ANALYSIS_EDGE);
    const analysis = measure(
      small.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, small.width, small.height),
    );
    if (!analysis) return null;

    const thumbCanvas = drawTo(bitmap, THUMB_EDGE);
    const previewCanvas = drawTo(bitmap, PREVIEW_EDGE);
    const thumb = await toBlob(thumbCanvas, 0.82);
    const preview = await toBlob(previewCanvas, 0.84);
    if (!thumb || !preview) return null;

    return {
      thumb,
      preview,
      width: bitmap.width,
      height: bitmap.height,
      analysis,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Measure an image that is already decoded: the palette, the tone, the detail.
 *
 * Returns `null` when there were no pixels to measure, which the caller turns
 * into an absent field rather than a zero — a black picture and an unreadable one
 * are not the same thing.
 */
export function measure(image: ImageData | undefined): Analysis | null {
  if (!image || image.data.length === 0) return null;
  const { data } = image;
  const count = data.length / 4;
  if (count === 0) return null;

  const pixels: [number, number, number][] = new Array(count);
  const luma = new Float64Array(count);
  let sumLuma = 0;
  let sumChroma = 0;
  let sumShift = 0;

  for (let index = 0; index < count; index += 1) {
    const red = data[index * 4];
    const green = data[index * 4 + 1];
    const blue = data[index * 4 + 2];
    pixels[index] = [red, green, blue];

    const value = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    luma[index] = value;
    sumLuma += value;

    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    sumChroma += high > 0 ? (high - low) / high : 0;
    sumShift += red - blue;
  }

  const mean = sumLuma / count;
  let variance = 0;
  for (let index = 0; index < count; index += 1) {
    const delta = luma[index] - mean;
    variance += delta * delta;
  }

  return {
    palette: paletteFrom(pixels),
    brightness: clamp(mean / 255),
    contrast: clamp(Math.sqrt(variance / count) / 255),
    sharpness: laplacianVariance(image, luma),
    saturation: clamp(sumChroma / count),
    temperatureShift: Math.max(-1, Math.min(1, sumShift / count / 255)),
  };
}

/**
 * The colours that cover the picture, most-covered first.
 *
 * Seeded from a 4-bit histogram, then one k-means pass so each swatch is the
 * true mean of the pixels behind it rather than the middle of its bucket —
 * exactly what the desktop build does, and the reason a swatch matches the
 * photograph instead of sitting a few percent off it.
 */
function paletteFrom(pixels: [number, number, number][]): DnaColor[] {
  if (pixels.length === 0) return [];

  const histogram = new Map<number, number>();
  for (const [red, green, blue] of pixels) {
    const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }

  const buckets = [...histogram.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const centres: [number, number, number][] = [];
  for (const [key] of buckets.slice(0, CANDIDATES)) {
    const centre: [number, number, number] = [
      ((key >> 8) & 0xf) * 17,
      ((key >> 4) & 0xf) * 17,
      (key & 0xf) * 17,
    ];
    if (centres.some((taken) => distance(taken, centre) < MERGE_DISTANCE)) continue;
    centres.push(centre);
    if (centres.length === PALETTE_SIZE) break;
  }
  if (centres.length === 0) return [];

  const sums = centres.map(() => [0, 0, 0]);
  const counts = centres.map(() => 0);
  for (const pixel of pixels) {
    let best = 0;
    let bestDistance = Number.MAX_VALUE;
    for (let index = 0; index < centres.length; index += 1) {
      const candidate = distance(centres[index], pixel);
      if (candidate < bestDistance) {
        bestDistance = candidate;
        best = index;
      }
    }
    sums[best][0] += pixel[0];
    sums[best][1] += pixel[1];
    sums[best][2] += pixel[2];
    counts[best] += 1;
  }

  const total = pixels.length;
  const palette: DnaColor[] = [];
  for (let index = 0; index < centres.length; index += 1) {
    if (counts[index] === 0) continue;
    const share = counts[index] / total;
    if (share < MINIMUM_SHARE || share > 1) continue;
    const red = Math.round(sums[index][0] / counts[index]);
    const green = Math.round(sums[index][1] / counts[index]);
    const blue = Math.round(sums[index][2] / counts[index]);
    palette.push({
      hex: `#${hex(red)}${hex(green)}${hex(blue)}`,
      red,
      green,
      blue,
      share,
    });
  }

  palette.sort((a, b) => b.share - a.share);
  return palette;
}

/**
 * Detail in focus, from the variance of the Laplacian response.
 *
 * Standard blur metric: a sharp edge leaves a large response, a blurred one
 * almost none. It needs the analyser's own luma array because reading pixels
 * back from the canvas a second time would mean a second `getImageData` per
 * picture, which is the expensive call here.
 */
function laplacianVariance(image: ImageData, luma: Float64Array): number {
  const { width, height } = image;
  if (width < 3 || height < 3) return 0;

  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const centre = luma[y * width + x];
      const neighbours =
        luma[y * width + (x - 1)] +
        luma[y * width + (x + 1)] +
        luma[(y - 1) * width + x] +
        luma[(y + 1) * width + x];
      const response = 4 * centre - neighbours;
      sum += response;
      sumSquares += response * response;
      count += 1;
    }
  }
  if (count === 0) return 0;

  const mean = sum / count;
  const variance = Math.max(0, sumSquares / count - mean * mean);
  return clamp(1 - Math.exp(-variance / SHARPNESS_REFERENCE));
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function hex(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0').toUpperCase();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * One frame of a video, as a JPEG.
 *
 * A `<video>` with an object URL can be told to seek, and what is on screen at
 * that moment is what `drawImage` copies. Some codes cannot be decoded at all,
 * which is why this resolves to `null` rather than hanging: the tile then shows
 * the icon it shows for a video with no preview.
 */
export function videoPoster(blob: Blob, edge = THUMB_EDGE, timeoutMs = 8000): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    let settled = false;

    const finish = (result: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    video.onloadeddata = () => {
      // A hair past the start: the first frame of a phone video is often black.
      const target = Number.isFinite(video.duration) ? Math.min(0.2, video.duration / 2) : 0.2;
      try {
        video.currentTime = target;
      } catch {
        capture();
      }
    };
    video.onseeked = capture;
    video.onerror = () => finish(null);

    function capture() {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return finish(null);
      const scale = Math.min(1, edge / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) return finish(null);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      void toBlob(canvas, 0.8).then(finish);
    }
  });
}

/**
 * Object URLs, keyed the way the archive refers to its own copies.
 *
 * The renderer asks for a URL synchronously (`assetUrl` is not async), so every
 * blob the interface might show is turned into a URL while its record is being
 * built. Handing out a fresh URL per render would leak one URL per frame.
 */
const urls = new Map<string, string>();

export function rememberUrl(key: string, blob: Blob): string {
  const existing = urls.get(key);
  if (existing) URL.revokeObjectURL(existing);
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}

export function urlFor(key: string): string | undefined {
  return urls.get(key);
}

export function releaseUrl(key: string): void {
  const existing = urls.get(key);
  if (existing) {
    URL.revokeObjectURL(existing);
    urls.delete(key);
  }
}

/** Drop every URL: used when the local archive is cleared. */
export function releaseAll(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}
