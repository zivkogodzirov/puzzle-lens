import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { compareNoisePattern, drawNoisePattern, expectedExact, NOISE_H, NOISE_W, putPixel, type NoiseCtx } from '../../src/device/noise';

/** A perfect read-back of the pattern (RGBA), with a horizontal red→blue gradient and white text area. */
function idealBuffer(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(NOISE_W * NOISE_H * 4);
  for (let y = 0; y < NOISE_H; y++) {
    for (let x = 0; x < NOISE_W; x++) {
      const i = (y * NOISE_W + x) * 4;
      const exact = expectedExact(x, y);
      let rgb: [number, number, number];
      if (exact) rgb = exact;
      else if (y >= 32 && y < 44) {
        const r = Math.round(255 * (1 - (x + 0.5) / NOISE_W));
        rgb = [r, 0, 255 - r];
      } else rgb = [255, 255, 255];
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  // "text"
  for (let x = 4; x < 20; x++) data[(50 * NOISE_W + x) * 4] = 0;
  return data;
}

function toBgra(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i + 2]!;
    out[i + 1] = rgba[i + 1]!;
    out[i + 2] = rgba[i]!;
    out[i + 3] = rgba[i + 3]!;
  }
  return out;
}

describe('canvas noise probe', () => {
  it('knows the exact colours of the solid and putImageData blocks', () => {
    expect(expectedExact(0, 0)).toEqual([200, 100, 50]);
    expect(expectedExact(40, 10)).toEqual([18, 52, 86]);
    expect(expectedExact(5, 20)).toEqual(putPixel(5, 4));
    expect(expectedExact(5, 40)).toBeNull(); // gradient
    expect(expectedExact(5, 60)).toBeNull(); // text
    expect(expectedExact(5, 70)).toEqual(putPixel(5, 6)); // drawImage copy
  });

  it('reports a perfect read-back as clean', () => {
    const r = compareNoisePattern(idealBuffer(), NOISE_W, NOISE_H, NOISE_W * 4, 'RGBA');
    expect(r.verdict).toBe('clean');
    expect(r.exact.checked).toBe(64 * 48);
    expect(r.exact.mismatched).toBe(0);
    expect(r.gradient.mismatched).toBe(0);
    expect(r.textPixels).toBeGreaterThan(0);
  });

  it('detects ±1 noise in the known pixels', () => {
    const data = idealBuffer();
    // Nudge every 37th pixel by one step, like fingerprinting protection does.
    for (let p = 0; p < NOISE_W * NOISE_H; p += 37) data[p * 4 + 1] = (data[p * 4 + 1]! + 1) % 256;
    const r = compareNoisePattern(data, NOISE_W, NOISE_H, NOISE_W * 4, 'RGBA');
    expect(r.verdict).toBe('noise');
    expect(r.exact.mismatched).toBeGreaterThan(10);
    expect(r.exact.maxDiff).toBeGreaterThanOrEqual(1);
    expect(r.samples.length).toBeGreaterThan(0);
  });

  it('flags gradient-only differences as "maybe", but tolerates ±1 dithering', () => {
    const data = idealBuffer();
    const i = (40 * NOISE_W + 10) * 4;
    data[i] = data[i]! - 1; // dithering-sized difference from its column
    data[i + 2] = data[i + 2]! + 1;
    expect(compareNoisePattern(data, NOISE_W, NOISE_H, NOISE_W * 4, 'RGBA').verdict).toBe('clean');
    data[i] = data[i]! - 3; // bigger than dithering
    expect(compareNoisePattern(data, NOISE_W, NOISE_H, NOISE_W * 4, 'RGBA').verdict).toBe('maybe');
  });

  it('reads BGRA frames and padded rows', () => {
    const bgra = toBgra(idealBuffer());
    expect(compareNoisePattern(bgra, NOISE_W, NOISE_H, NOISE_W * 4, 'BGRA').verdict).toBe('clean');
    // Same data read as RGBA must look wrong (proves the channel order matters).
    expect(compareNoisePattern(bgra, NOISE_W, NOISE_H, NOISE_W * 4, 'RGBA').verdict).toBe('noise');
    // Rows padded to 300 bytes.
    const stride = 300;
    const src = idealBuffer();
    const padded = new Uint8ClampedArray(stride * NOISE_H);
    for (let y = 0; y < NOISE_H; y++) padded.set(src.subarray(y * NOISE_W * 4, (y + 1) * NOISE_W * 4), y * stride);
    expect(compareNoisePattern(padded, NOISE_W, NOISE_H, stride, 'RGBA').verdict).toBe('clean');
  });

  it('refuses a read-back that is too small', () => {
    expect(() => compareNoisePattern(new Uint8ClampedArray(16), 2, 2, 8)).toThrow(/expected at least/);
  });

  it('draws a pattern a real 2D canvas reads back exactly (no noise outside Safari)', () => {
    const canvas = createCanvas(NOISE_W, NOISE_H);
    const ctx = canvas.getContext('2d');
    drawNoisePattern(ctx as unknown as NoiseCtx);
    const img = ctx.getImageData(0, 0, NOISE_W, NOISE_H);
    const r = compareNoisePattern(img.data, NOISE_W, NOISE_H, NOISE_W * 4, 'RGBA');
    expect(r.exact.mismatched).toBe(0);
    expect(r.textPixels).toBeGreaterThan(20);
    // Skia dithers gradients by ±1; that must not count as noise.
    expect(r.verdict).toBe('clean');
  });
});
