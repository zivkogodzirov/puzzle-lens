/**
 * Procedural "kiss-like" artwork: a portrait composition in the spirit of the owner's puzzle
 * (Hayez, The Kiss): mostly mid and dark tones (dark wall, red-brown cloak), a pale blue satin
 * dress with near-white highlights (~15 % of the area is pale or near-white, including one large
 * sheen patch so that a few pieces are genuinely white-on-white), beige stone steps at the
 * bottom, and a plain, almost texture-free wall at the top (a "sky"-like region).
 *
 * Built at ¼ resolution in plain JS (regions, folds, blocks), smoothly enlarged with the canvas,
 * then fine print grain is added per pixel. Deterministic for a given seed and size.
 */
import { createCanvas, ImageData } from '@napi-rs/canvas';
import type { SynthArt } from './types';

type RGB = [number, number, number];

export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal noise in [0, 1). */
function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    s += amp * valueNoise(x * f, y * f, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return s / norm;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

/** Soft ellipse membership with a noisy border (1 inside, 0 outside). */
function blob(u: number, v: number, cu: number, cv: number, ru: number, rv: number, wobble: number, seed: number): number {
  const du = (u - cu) / ru;
  const dv = (v - cv) / rv;
  const d = Math.sqrt(du * du + dv * dv) + (fbm(u * 6, v * 6, seed, 3) - 0.5) * wobble;
  return 1 - smooth(0.975, 1.0, d);
}

function kissLow(lw: number, lh: number, seed: number): { rgb: Uint8ClampedArray; grain: Float32Array } {
  const out = new Uint8ClampedArray(lw * lh * 4);
  const grain = new Float32Array(lw * lh);
  const s = seed * 7 + 3;
  // Composition jitter per seed so that different art seeds are really different pictures.
  const j = (k: number, a: number) => (hash2(k, 99, s) * 2 - 1) * a;
  const dressC: [number, number] = [0.6 + j(1, 0.05), 0.6 + j(2, 0.04)];
  const manC: [number, number] = [0.36 + j(3, 0.05), 0.5 + j(4, 0.04)];
  const sheenC: [number, number] = [dressC[0] + 0.03 + j(5, 0.03), dressC[1] - 0.08 + j(6, 0.03)];
  const topEdge = 0.2 + j(7, 0.03);
  const stepEdge = 0.85 + j(8, 0.02);
  const aspect = lw / lh;

  const wall: RGB = [64, 55, 46];
  const plainA: RGB = [118, 108, 88];
  const plainB: RGB = [138, 126, 101];
  const cloak: RGB = [96, 42, 33];
  const cloakDark: RGB = [52, 30, 26];
  const dressBase: RGB = [146, 171, 203];
  // Near-white satin: NOT systematically bluer or brighter than the white table; some patches a
  // little darker (shaded), some a little warmer (yellowed varnish).
  const paleDark: RGB = [221, 220, 216];
  const paleNeutral: RGB = [234, 233, 229];
  const paleWarm: RGB = [240, 233, 220];
  const stone: RGB = [198, 181, 148];
  const skin: RGB = [214, 172, 142];
  const hair: RGB = [48, 34, 26];
  const green: RGB = [62, 84, 52];

  for (let y = 0; y < lh; y++) {
    const v = (y + 0.5) / lh;
    for (let x = 0; x < lw; x++) {
      const u = (x + 0.5) / lw;
      const wu = u + 0.03 * (fbm(u * 3, v * 3, s + 1, 3) - 0.5);
      const wv = v + 0.03 * (fbm(u * 3 + 9, v * 3, s + 2, 3) - 0.5);
      let col: RGB;
      let g = 1;

      // Background: dark wall of stone blocks with mid-tone variation.
      const bx = Math.floor(wu * 14 * aspect + (Math.floor(wv * 22) % 2) * 0.5);
      const by = Math.floor(wv * 22);
      const block = 0.8 + 0.4 * hash2(bx, by, s + 5);
      const mortar = Math.min(Math.abs(((wv * 22) % 1) - 0.5), Math.abs(((wu * 14 * aspect + (by % 2) * 0.5) % 1) - 0.5)) > 0.46 ? 0.7 : 1;
      col = scale(wall, block * mortar * (0.75 + 0.5 * fbm(u * 20, v * 20, s + 6)));
      // Occasional green/gold accents in the wall.
      const acc = fbm(u * 8, v * 8, s + 7, 3);
      if (acc > 0.68) col = mix(col, green, smooth(0.68, 0.75, acc) * 0.7);

      // Plain wall at the top ("sky"): smooth, very low texture.
      const topLine = topEdge + 0.02 * Math.sin(u * 7 + seed);
      if (wv < topLine) {
        col = mix(plainA, plainB, u * 0.6 + v * 1.2);
        g = 0.12;
      }

      // Stone steps at the bottom: beige with seams.
      if (wv > stepEdge) {
        const step = (wv - stepEdge) * 30;
        const seam = Math.abs((step % 1) - 0.5) > 0.44 ? 0.62 : 1;
        col = scale(stone, seam * (0.88 + 0.2 * fbm(u * 25, v * 25, s + 8)));
        g = 0.6;
      }

      // The man: red-brown cloak with dark folds.
      const man = blob(wu, wv, manC[0], manC[1], 0.17, 0.33, 0.25, s + 9) * (wv < stepEdge + 0.02 ? 1 : 0);
      if (man > 0) {
        const fold = 0.5 + 0.5 * Math.sin((wu * 18 + 3 * fbm(u * 4, v * 4, s + 10)) * Math.PI);
        const c = mix(cloakDark, cloak, fold * (0.6 + 0.4 * fbm(u * 15, v * 15, s + 11)));
        col = mix(col, c, man);
        g = g * (1 - man) + 0.8 * man;
      }

      // The dress: pale blue satin with near-white highlights on the folds.
      const dress = blob(wu, wv, dressC[0], dressC[1], 0.19, 0.28, 0.2, s + 12) * (wv < stepEdge + 0.04 ? 1 : 0);
      if (dress > 0) {
        const f = Math.sin((wu * 11 + wv * 3 + 2.5 * fbm(u * 3, v * 3, s + 13)) * Math.PI * 2);
        const shade = 0.78 + 0.22 * f;
        let c = scale(dressBase, shade);
        const hi = smooth(0.55, 0.95, f) * 0.75;
        // One broad sheen patch: near-white, barely any texture (the white-on-white case).
        const sheen = blob(wu, wv, sheenC[0], sheenC[1], 0.085, 0.075, 0.15, s + 14);
        const tv = fbm(u * 5 + 3, v * 5, s + 17, 2);
        const nearWhite = tv < 0.45 ? mix(paleDark, paleNeutral, smooth(0.2, 0.45, tv)) : mix(paleNeutral, paleWarm, smooth(0.5, 0.75, tv));
        c = mix(c, nearWhite, Math.min(1, hi + sheen));
        col = mix(col, c, dress);
        g = g * (1 - dress) + dress * (0.45 - 0.33 * sheen);
      }

      // Heads: skin and dark hair.
      const face = blob(wu, wv, (manC[0] + dressC[0]) / 2 + 0.02, 0.27, 0.05, 0.055, 0.2, s + 15);
      const hairB = blob(wu, wv, manC[0] + 0.04, 0.23, 0.07, 0.05, 0.3, s + 16);
      if (hairB > 0) col = mix(col, hair, hairB);
      if (face > 0) col = mix(col, skin, face * 0.95);

      const i = y * lw + x;
      out[i * 4] = col[0];
      out[i * 4 + 1] = col[1];
      out[i * 4 + 2] = col[2];
      out[i * 4 + 3] = 255;
      grain[i] = g;
    }
  }
  return { rgb: out, grain };
}

/** Procedural kiss-like art of `width × height` px. */
export function proceduralKissArt(width: number, height: number, seed: number): Uint8Array {
  const f = 4;
  const lw = Math.max(8, Math.ceil(width / f));
  const lh = Math.max(8, Math.ceil(height / f));
  const { rgb, grain } = kissLow(lw, lh, seed);
  const low = createCanvas(lw, lh);
  low.getContext('2d').putImageData(new ImageData(rgb, lw, lh), 0, 0);
  const big = createCanvas(width, height);
  const ctx = big.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(low, 0, 0, lw, lh, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  // Fine print grain (two scales), weighted by the region's grain amplitude.
  const out = new Uint8Array(width * height * 4);
  const s = seed * 13 + 5;
  for (let y = 0; y < height; y++) {
    const gy = Math.min(lh - 1, (y / f) | 0);
    for (let x = 0; x < width; x++) {
      const gx = Math.min(lw - 1, (x / f) | 0);
      const amp = grain[gy * lw + gx]! * 22;
      const n =
        (hash2(x, y, s) - 0.5) * 0.5 +
        (hash2(x >> 1, y >> 1, s + 1) - 0.5) * 0.7 +
        (hash2(x >> 2, y >> 2, s + 2) - 0.5) * 0.6 +
        (valueNoise(x / 6, y / 6, s + 3) - 0.5) * 1.2;
      const k = 1 + (n * amp) / 128;
      const i = (y * width + x) * 4;
      out[i] = Math.min(255, Math.max(0, data[i]! * k));
      out[i + 1] = Math.min(255, Math.max(0, data[i + 1]! * k));
      out[i + 2] = Math.min(255, Math.max(0, data[i + 2]! * k));
      out[i + 3] = 255;
    }
  }
  return out;
}

export function makeArt(
  puzzleMm: [number, number],
  spec: { kind: 'procedural-kiss-like'; seed?: number; pxPerMm?: number } | { kind: 'rgba'; width: number; height: number; rgba: Uint8Array | Uint8ClampedArray },
  puzzleSeed: number,
): SynthArt {
  if (spec.kind === 'rgba') {
    if (spec.rgba.length !== spec.width * spec.height * 4) throw new Error('art: rgba size does not match width × height × 4');
    return {
      width: spec.width,
      height: spec.height,
      rgba: new Uint8Array(spec.rgba),
      pxPerMm: [spec.width / puzzleMm[0], spec.height / puzzleMm[1]],
    };
  }
  const ppm = spec.pxPerMm ?? Math.min(8, Math.sqrt(12e6 / (puzzleMm[0] * puzzleMm[1])));
  const width = Math.max(16, Math.round(puzzleMm[0] * ppm));
  const height = Math.max(16, Math.round(puzzleMm[1] * ppm));
  const rgba = proceduralKissArt(width, height, spec.seed ?? puzzleSeed);
  return { width, height, rgba, pxPerMm: [width / puzzleMm[0], height / puzzleMm[1]] };
}
