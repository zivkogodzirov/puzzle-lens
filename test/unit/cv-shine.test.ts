/**
 * A lamp's shine on the cream table (M10 part 3, SEG.shine). On the owner's table a lamp's reflection
 * shows as a broad, slightly brighter, bluer-white patch with the surface's texture in it; the per-pixel
 * test reads it as faint print, and it swallowed the pieces lying in it into one big "object" (2 dark
 * pieces on IMG_9377, 4 white ones at the rim on IMG_9375). A drawn cream table with such a patch
 * (soft, no edge), 2 dark pieces inside it and 12 elsewhere: with the rule every piece is found and
 * nothing else (no piece on the bare shine, no object); without it the 2 are lost. A hot middle far
 * off the table's colour (IMG_9263) is shine too, not a piece or an object. Several noise seeds. The owner's own photos are measured in cv-real-counts.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { findPieces, SEG } from '../../src/cv/pieceFinder';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { getCv } from '../helpers/cv';
import { rng } from '../helpers/images';

const PPM = 4;
const W = 1600;
const H = 1200;

function inPiece(x: number, y: number, cx: number, cy: number): boolean {
  const u = x - cx;
  const v = y - cy;
  if (Math.hypot(u - 44, v) < 12) return true; // knob
  if (Math.hypot(u, v + 34) < 11) return false; // blank
  return Math.abs(u) <= 36 && Math.abs(v) <= 36;
}

function drawTable(seed: number, hot = false): { img: PixelBuffer; inShine: Array<[number, number]>; elsewhere: Array<[number, number]> } {
  const r = rng(seed);
  const data = new Uint8Array(W * H * 4);
  const inShine: Array<[number, number]> = [
    [700, 560],
    [860, 640],
  ];
  const elsewhere: Array<[number, number]> = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 6; i++) elsewhere.push([150 + i * 250, j === 0 ? 150 : 1050]);
  const all = [...inShine, ...elsewhere];
  const lamp = [780, 600];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const fall = 1 - 0.04 * (x / W);
      let R = 201 * fall;
      let G = 190 * fall;
      let B = 180 * fall;
      // The shine: up to 20 % brighter, bluer-white, with the surface's texture; no edge.
      const g = Math.exp(-((x - lamp[0]!) ** 2 + (y - lamp[1]!) ** 2) / (2 * 150 * 150));
      const tex = 1 + 0.03 * (r() - 0.5) * g;
      R = R * (1 + 0.2 * g) * tex - 18 * g;
      G = G * (1 + 0.2 * g) * tex;
      B = B * (1 + 0.2 * g) * tex + 18 * g;
      let piece = false;
      for (const [cx, cy] of all) if (inPiece(x, y, cx, cy)) piece = true;
      // A hot middle far off the table's colour (bluer, brighter): reads as strong print, no edge shadow.
      if (hot && !piece && Math.hypot(x - lamp[0]!, y - lamp[1]!) < 30) {
        R = 205;
        G = 225;
        B = 255;
      }
      let shade = false;
      if (!piece) for (const [cx, cy] of all) if (inPiece(x + 3, y - 3, cx, cy)) shade = true;
      if (piece) {
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
  return { img: { data, width: W, height: H, stride: W * 4 }, inShine, elsewhere };
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
  });
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

describe("a lamp's shine on the cream table (SEG.shine)", () => {
  it('finds the pieces lying in the shine, and nothing else; without the rule they are lost', async () => {
    const cv = await getCv();
    const was = SEG.shine;
    for (const seed of [7, 2, 3, 9]) {
      const { img, inShine, elsewhere } = drawTable(seed);
      const found = (res: ReturnType<typeof find>, [x, y]: [number, number]) =>
        res.pieces.some((p) => Math.hypot(centre(p.outlineImg)[0] - x, centre(p.outlineImg)[1] - y) < 25);
      const on = find(cv, img);
      for (const c of inShine) expect(found(on, c), `seed ${seed}: piece at ${c.join(',')} in the shine`).toBe(true);
      for (const c of elsewhere) expect(found(on, c), `seed ${seed}: piece at ${c.join(',')}`).toBe(true);
      expect(on.pieces.length, `seed ${seed}: pieces (nothing on the bare shine)`).toBe(inShine.length + elsewhere.length);
      expect(on.regions.length, `seed ${seed}: objects`).toBe(0);
      (SEG as { shine: boolean }).shine = false;
      let off: ReturnType<typeof find>;
      try {
        off = find(cv, img);
      } finally {
        (SEG as { shine: boolean }).shine = was;
      }
      expect(inShine.filter((c) => found(off, c)).length, `seed ${seed}: pieces in the shine found without the rule`).toBe(0);
    }
  }, 120_000);

  it("takes a reflection's hot middle (far off the table's colour) for shine, not a piece or an object", async () => {
    const cv = await getCv();
    for (const seed of [7, 2]) {
      const { img, inShine, elsewhere } = drawTable(seed, true);
      const res = find(cv, img);
      expect(res.pieces.length, `seed ${seed}: pieces`).toBe(inShine.length + elsewhere.length);
      expect(res.regions.length, `seed ${seed}: objects`).toBe(0);
      expect(
        res.pieces.some((p) => Math.hypot(centre(p.outlineImg)[0] - 780, centre(p.outlineImg)[1] - 600) < 40),
        `seed ${seed}: a piece at the hot middle`,
      ).toBe(false);
    }
  }, 120_000);
});
