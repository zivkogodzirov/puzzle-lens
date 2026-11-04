/**
 * Canvas readback noise probe (RESEARCH §3, §19 item 6). With Safari's "Advanced Tracking and
 * Fingerprinting Protection" on, reading pixels back from a canvas can return slightly changed
 * values. We draw a small pattern whose pixels are known, read it back and compare:
 *   - two solid colour blocks (fillRect)            → must match exactly;
 *   - a block written with putImageData             → must match exactly;
 *   - a copy of that block made with drawImage      → must match exactly (closest to drawing
 *     photo tiles into a canvas and reading them back);
 *   - a horizontal canvas gradient (red → blue)     → rows identical (±1 allowed: renderers may
 *     dither gradients), green ≈ 0, red + blue ≈ 255;
 *   - some text                                     → not compared, only counted (noise
 *     protection may treat canvases with text differently, so the pattern contains some).
 * Worker-safe: used on the main thread (HTML canvas) and in the probe worker (OffscreenCanvas).
 * The loops below touch 64 × 80 pixels only.
 */
import type { NoiseComparison, PixelCompare } from '../shared/probeApi';

export const NOISE_W = 64;
export const NOISE_H = 80;

type Rgb = [number, number, number];
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FLAT: Array<Rect & { rgb: Rgb }> = [
  { x: 0, y: 0, w: 32, h: 16, rgb: [200, 100, 50] },
  { x: 32, y: 0, w: 32, h: 16, rgb: [18, 52, 86] },
];
const PUT: Rect = { x: 0, y: 16, w: 64, h: 16 };
const GRAD: Rect = { x: 0, y: 32, w: 64, h: 12 };
const TEXT: Rect = { x: 0, y: 44, w: 64, h: 20 };
const DRAWN: Rect = { x: 0, y: 64, w: 64, h: 16 };
const GRADIENT_TOLERANCE = 2;
/** Gradients may be dithered by ±1 between rows (Skia does this); more than that counts. */
const GRADIENT_ROW_TOLERANCE = 1;

/** The colour written with putImageData at (lx, ly) inside the PUT block. Many distinct values. */
export function putPixel(lx: number, ly: number): Rgb {
  return [(lx * 4 + ly * 3) & 255, (lx * 7 + 40) & 255, (ly * 13 + lx * 2 + 5) & 255];
}

/** The minimal 2D-context surface we need (satisfied by CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D). */
export interface NoiseCtx {
  fillStyle: unknown;
  font: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  readonly canvas: unknown;
  drawImage(image: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(offset: number, color: string): void };
  createImageData(sw: number, sh: number): { data: Uint8ClampedArray; width: number; height: number };
  putImageData(imageData: { data: Uint8ClampedArray; width: number; height: number }, dx: number, dy: number): void;
}

export function drawNoisePattern(ctx: NoiseCtx): void {
  for (const f of FLAT) {
    ctx.fillStyle = `rgb(${f.rgb[0]}, ${f.rgb[1]}, ${f.rgb[2]})`;
    ctx.fillRect(f.x, f.y, f.w, f.h);
  }
  const img = ctx.createImageData(PUT.w, PUT.h);
  for (let ly = 0; ly < PUT.h; ly++) {
    for (let lx = 0; lx < PUT.w; lx++) {
      const [r, g, b] = putPixel(lx, ly);
      const i = (ly * PUT.w + lx) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, PUT.x, PUT.y);
  const grad = ctx.createLinearGradient(GRAD.x, 0, GRAD.x + GRAD.w, 0);
  grad.addColorStop(0, 'rgb(255, 0, 0)');
  grad.addColorStop(1, 'rgb(0, 0, 255)');
  ctx.fillStyle = grad;
  ctx.fillRect(GRAD.x, GRAD.y, GRAD.w, GRAD.h);
  ctx.fillStyle = 'rgb(255, 255, 255)';
  ctx.fillRect(TEXT.x, TEXT.y, TEXT.w, TEXT.h);
  ctx.fillStyle = 'rgb(0, 0, 0)';
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('Puzzle 0123', 1, TEXT.y + 1);
  ctx.fillText('Lens ABCxyz', 1, TEXT.y + 10);
  // Last, so it also covers any text that spills below its block (descenders).
  ctx.drawImage(ctx.canvas, PUT.x, PUT.y, PUT.w, PUT.h, DRAWN.x, DRAWN.y, DRAWN.w, DRAWN.h);
}

/** The exact colour expected at (x, y), or null where the value isn't known exactly. */
export function expectedExact(x: number, y: number): Rgb | null {
  for (const f of FLAT) if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) return f.rgb;
  if (x >= PUT.x && x < PUT.x + PUT.w && y >= PUT.y && y < PUT.y + PUT.h) return putPixel(x - PUT.x, y - PUT.y);
  if (x >= DRAWN.x && x < DRAWN.x + DRAWN.w && y >= DRAWN.y && y < DRAWN.y + DRAWN.h) return putPixel(x - DRAWN.x, y - DRAWN.y);
  return null;
}

function emptyCompare(): PixelCompare {
  return { checked: 0, mismatched: 0, maxDiff: 0 };
}

/**
 * Compares read-back pixels with the pattern. `stride` is bytes per row; `order` says whether
 * the bytes are RGBA (canvas) or BGRA (some VideoFrames).
 */
export function compareNoisePattern(
  data: ArrayLike<number>,
  width: number,
  height: number,
  stride: number,
  order: 'RGBA' | 'BGRA' = 'RGBA',
): NoiseComparison {
  if (width < NOISE_W || height < NOISE_H) throw new Error(`Read-back is ${width}×${height}, expected at least ${NOISE_W}×${NOISE_H}`);
  const px = (x: number, y: number): Rgb => {
    const i = y * stride + x * 4;
    const a = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const c = data[i + 2] ?? 0;
    return order === 'RGBA' ? [a, g, c] : [c, g, a];
  };
  const exact = emptyCompare();
  const gradient = emptyCompare();
  const samples: NoiseComparison['samples'] = [];
  const note = (x: number, y: number, expected: Rgb, got: Rgb) => {
    if (samples.length < 6) samples.push({ x, y, expected, got });
  };

  for (let y = 0; y < NOISE_H; y++) {
    for (let x = 0; x < NOISE_W; x++) {
      const want = expectedExact(x, y);
      if (!want) continue;
      const got = px(x, y);
      exact.checked++;
      const d = Math.max(Math.abs(got[0] - want[0]), Math.abs(got[1] - want[1]), Math.abs(got[2] - want[2]));
      if (d > 0) {
        exact.mismatched++;
        exact.maxDiff = Math.max(exact.maxDiff, d);
        note(x, y, want, got);
      }
    }
  }

  // Gradient: rows (almost) identical to the first row; green ≈ 0; red + blue ≈ 255.
  for (let y = GRAD.y; y < GRAD.y + GRAD.h; y++) {
    for (let x = GRAD.x; x < GRAD.x + GRAD.w; x++) {
      const got = px(x, y);
      const ref = px(x, GRAD.y);
      gradient.checked++;
      const rowDiff = Math.max(Math.abs(got[0] - ref[0]), Math.abs(got[1] - ref[1]), Math.abs(got[2] - ref[2]));
      const sumDiff = Math.abs(got[0] + got[2] - 255);
      const bad = Math.max(rowDiff > GRADIENT_ROW_TOLERANCE ? rowDiff : 0, got[1] > GRADIENT_TOLERANCE ? got[1] : 0, sumDiff > GRADIENT_TOLERANCE ? sumDiff : 0);
      if (bad > 0) {
        gradient.mismatched++;
        gradient.maxDiff = Math.max(gradient.maxDiff, bad);
        note(x, y, ref, got);
      }
    }
  }

  let textPixels = 0;
  for (let y = TEXT.y; y < TEXT.y + TEXT.h; y++) {
    for (let x = TEXT.x; x < TEXT.x + TEXT.w; x++) {
      const [r, g, b] = px(x, y);
      if (r < 250 || g < 250 || b < 250) textPixels++;
    }
  }

  const verdict: NoiseComparison['verdict'] = exact.mismatched > 0 ? 'noise' : gradient.mismatched > 0 ? 'maybe' : 'clean';
  return { exact, gradient, textPixels, verdict, samples };
}
