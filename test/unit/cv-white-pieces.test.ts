/**
 * White pieces on a smooth one-colour table (M10 part 2, SEG.whiteStep): near-white print is only a little
 * brighter than a cream table and nearly colourless, like a lamp's reflection. A drawn cream table
 * with white pieces (sharp edges, a thin shadow on one side), a few dark pieces and soft, piece-sized
 * spots of light shaped like an L (no edge anywhere; as bright as the white pieces and brighter), as
 * on the owner's skyline photos (2026-11-17): the white pieces are found, without the white-step rule
 * they are lost (so the rule is what finds them), and no soft spot is a piece (review 2026-11-17: the
 * first version's border test let one through). Several noise seeds. The owner's own
 * photos are measured in cv-real-counts.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { findPieces, SEG } from '../../src/cv/pieceFinder';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { getCv } from '../helpers/cv';
import { rng } from '../helpers/images';

const PPM = 4;
const W = 1600;
const H = 1200;

/** A piece-like shape: a 72 px square with a knob on the right and a blank on the top. */
function inPiece(x: number, y: number, cx: number, cy: number): boolean {
  const u = x - cx;
  const v = y - cy;
  const half = 36;
  if (Math.hypot(u - 44, v) < 12) return true; // knob
  if (Math.hypot(u, v + 34) < 11) return false; // blank
  return Math.abs(u) <= half && Math.abs(v) <= half;
}

function drawTable(seed: number): { img: PixelBuffer; white: Array<[number, number]>; spots: Array<[number, number]> } {
  const r = rng(seed);
  const data = new Uint8Array(W * H * 4);
  const white: Array<[number, number]> = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) white.push([220 + i * 170, 220 + j * 170]);
  const dark: Array<[number, number]> = [];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 2; i++) dark.push([1020 + i * 170, 200 + j * 170]);
  // Soft L-shaped spots of light (three overlapping Gaussian blobs blending 60 % towards a warm white: one,
  // one to the right, one below), piece-sized, as the review's probe drew them (2026-11-17).
  const L: Array<[number, number]> = [
    [14, 30],
    [12, 27],
    [16, 33],
    [13, 29],
  ];
  const spots: Array<[number, number]> = L.map((_, i) => [200 + i * 220, 960]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // Cream table, a gentle light falloff, noise.
      const fall = 1 - 0.04 * (x / W);
      let R = 201 * fall;
      let G = 190 * fall;
      let B = 180 * fall;
      // Soft spots of light: brighter and whiter, no edge.
      spots.forEach(([sx, sy], i) => {
        const [sg, d] = L[i]!;
        for (const [ox, oy] of [
          [0, 0],
          [d, 0],
          [0, d],
        ] as const) {
          const g = Math.exp(-((x - sx - ox) ** 2 + (y - sy - oy) ** 2) / (2 * sg * sg));
          R += (240 - R) * 0.6 * g;
          G += (238 - G) * 0.6 * g;
          B += (234 - B) * 0.6 * g;
        }
      });
      let piece: 'white' | 'dark' | null = null;
      for (const [cx, cy] of white) if (inPiece(x, y, cx, cy)) piece = 'white';
      for (const [cx, cy] of dark) if (inPiece(x, y, cx, cy)) piece = 'dark';
      // Thin shadow below-left of each piece (light from the top right).
      let shade = false;
      if (!piece) for (const [cx, cy] of [...white, ...dark]) if (inPiece(x + 3, y - 3, cx, cy)) shade = true;
      if (piece === 'white') {
        // About 11 % brighter than the table and nearly neutral: per pixel it reads as shine (glare).
        R = 214;
        G = 210;
        B = 212;
      } else if (piece === 'dark') {
        R = 60;
        G = 72;
        B = 105;
      } else if (shade) {
        R *= 0.82;
        G *= 0.82;
        B *= 0.82;
      }
      const n = (r() - 0.5) * 4;
      const k = (y * W + x) * 4;
      data[k] = Math.max(0, Math.min(255, Math.round(R + n)));
      data[k + 1] = Math.max(0, Math.min(255, Math.round(G + n)));
      data[k + 2] = Math.max(0, Math.min(255, Math.round(B + n)));
      data[k + 3] = 255;
    }
  return { img: { data, width: W, height: H, stride: W * 4 }, white, spots };
}

function find(cv: Awaited<ReturnType<typeof getCv>>, img: PixelBuffer) {
  return findPieces(cv, img, {
    imgToTable: [1 / PPM, 0, -W / 2 / PPM, 0, 1 / PPM, -H / 2 / PPM, 0, 0, 1],
    tableToImg: [PPM, 0, W / 2, 0, PPM, H / 2, 0, 0, 1],
    map: null,
    table: null,
    pxPerMm: PPM,
    zoom: 1,
    pieceAreaMm2: 273,
    withGlareMask: false,
  }).pieces;
}

function centre(o: number[]): [number, number] {
  let x = 0;
  let y = 0;
  for (let i = 0; i < o.length; i += 2) {
    x += o[i]!;
    y += o[i + 1]!;
  }
  return [(2 * x) / o.length, (2 * y) / o.length];
}

describe('white pieces on a cream table (SEG.whiteStep)', () => {
  it('finds the white pieces, never a soft spot of light; without the rule the white pieces are lost', async () => {
    const cv = await getCv();
    const near = (pieces: ReturnType<typeof find>, [x, y]: [number, number], d: number) =>
      pieces.some((p) => !p.flags.clump && Math.hypot(centre(p.outlineImg)[0] - x, centre(p.outlineImg)[1] - y) < d);
    const was = SEG.whiteStep;
    for (const seed of [7, 2, 3, 9]) {
      const { img, white, spots } = drawTable(seed);
      const on = find(cv, img);
      const foundOn = white.filter((c) => near(on, c, 20)).length;
      expect(foundOn, `seed ${seed}: white pieces found`).toBeGreaterThanOrEqual(10);
      (SEG as { whiteStep: boolean }).whiteStep = false;
      let off: ReturnType<typeof find>;
      try {
        off = find(cv, img);
      } finally {
        (SEG as { whiteStep: boolean }).whiteStep = was;
      }
      expect(white.filter((c) => near(off, c, 20)).length, `seed ${seed}: white pieces found without the rule`).toBeLessThanOrEqual(2);
      // No soft spot is a piece (without the border-band test, review 2026-11-17, the rule made one).
      for (const sp of spots) expect(near(on, sp, 40), `seed ${seed}: soft spot at ${sp.join(',')} taken for a piece`).toBe(false);
    }
  }, 120_000);
});
