/**
 * Colour groups for trays (src/cv/colourGroups.ts): a piece's main colour (and a second one), and
 * pieces grouped by colour, darkest group first.
 */
import { describe, expect, it } from 'vitest';
import { dist2, evenLight, GROUPS, groupColours, inkOn, labToHex, pieceColours, pieceGroup, tableAround, type Lab } from '../../src/cv/colourGroups';
import { labImage, PATCH_SIZE } from '../../src/cv/placement';

const S = PATCH_SIZE;

/** A straightened piece: a disc of the piece (alpha 255) on nothing; `paint(x, y)` gives its RGB. */
function patch(paint: (x: number, y: number) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const k = (y * S + x) * 4;
      if ((x - S / 2) ** 2 + (y - S / 2) ** 2 > (S * 0.45) ** 2) continue;
      const [r, g, b] = paint(x, y);
      out[k] = r;
      out[k + 1] = g;
      out[k + 2] = b;
      out[k + 3] = 255;
    }
  return out;
}

function labOf(rgb: [number, number, number]): Lab {
  const l = labImage({ data: new Uint8Array([...rgb, 255]), width: 1, height: 1, stride: 4 }, 1, 1);
  return [l[0]!, l[1]!, l[2]!];
}

describe("a piece's colours", () => {
  it('one colour (with a little noise): one main colour, no second', () => {
    let s = 7;
    const noise = () => ((s = (s * 1103515245 + 12345) >>> 0) % 7) - 3;
    const pc = pieceColours(patch(() => [120 + noise(), 80 + noise(), 60 + noise()]))!;
    expect(pc.second).toBeNull();
    expect(pc.mainShare).toBe(1);
    expect(Math.sqrt(dist2(pc.main, labOf([120, 80, 60])))).toBeLessThan(2);
  });

  it('two colours (sky over grass, 70 / 30): the larger one is the main colour', () => {
    const pc = pieceColours(patch((_x, y) => (y < S * 0.62 ? [90, 150, 220] : [60, 140, 50])))!;
    expect(Math.sqrt(dist2(pc.main, labOf([90, 150, 220])))).toBeLessThan(2);
    expect(Math.sqrt(dist2(pc.second!, labOf([60, 140, 50])))).toBeLessThan(2);
    expect(pc.mainShare).toBeGreaterThan(0.6);
    expect(pc.secondShare).toBeGreaterThan(GROUPS.alsoShare - 0.1);
  });

  it('too little of the piece in the patch: no colours', () => {
    expect(pieceColours(new Uint8Array(S * S * 4))).toBeNull();
  });

  it('exactly the colours of the plain way (the whole patch in Lab, every second pixel), done faster (2026-11-10)', () => {
    // The plain way, as before 2026-11-10: the whole patch turned into Lab, then 2-means on every
    // second pixel of every second row that is the piece's.
    const plain = (rgba: Uint8Array) => {
      const lab = labImage({ data: rgba, width: S, height: S, stride: S * 4 }, S, S);
      const px: number[] = [];
      for (let y = 0; y < S; y += 2)
        for (let x = 0; x < S; x += 2) if (rgba[(y * S + x) * 4 + 3]! >= 128) px.push(...lab.subarray((y * S + x) * 3, (y * S + x) * 3 + 3));
      const n = px.length / 3;
      if (n < 20) return null;
      const pixels = Float32Array.from(px);
      const mean: Lab = [0, 0, 0];
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c]! += pixels[i * 3 + c]! / n;
      const far = (from: ArrayLike<number>): Lab => {
        let best = 0;
        let bi = 0;
        for (let i = 0; i < n; i++) {
          const d = dist2(pixels.subarray(i * 3, i * 3 + 3), from);
          if (d > best) ((best = d), (bi = i));
        }
        return [pixels[bi * 3]!, pixels[bi * 3 + 1]!, pixels[bi * 3 + 2]!];
      };
      let c0 = far(mean);
      let c1 = far(c0);
      let n0 = 0;
      for (let it = 0; it < 10; it++) {
        const s0: Lab = [0, 0, 0];
        const s1: Lab = [0, 0, 0];
        n0 = 0;
        for (let i = 0; i < n; i++) {
          const p = pixels.subarray(i * 3, i * 3 + 3);
          const to0 = dist2(p, c0) <= dist2(p, c1);
          for (let c = 0; c < 3; c++) (to0 ? s0 : s1)[c]! += p[c]!;
          if (to0) n0++;
        }
        if (!n0 || n0 === n) break;
        c0 = s0.map((v) => v / n0) as Lab;
        c1 = s1.map((v) => v / (n - n0)) as Lab;
      }
      if (!n0 || n0 === n || Math.sqrt(dist2(c0, c1)) < GROUPS.sameColour) return { main: mean, mainShare: 1, second: null, secondShare: 0 };
      const [main, second, nm] = n0 >= n - n0 ? [c0, c1, n0] : [c1, c0, n - n0];
      return { main, mainShare: nm / n, second, secondShare: 1 - nm / n };
    };
    let s = 3;
    const r = () => (s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32;
    for (let k = 0; k < 30; k++) {
      // Two or three colours with noise, a ragged outline, and some half-transparent edge pixels.
      const cols = Array.from({ length: 2 + (k % 2) }, () => [r() * 255, r() * 255, r() * 255]);
      const rgba = new Uint8Array(S * S * 4);
      for (let i = 0; i < S * S; i++) {
        const c = cols[Math.floor((i % S) / (S / cols.length)) % cols.length]!;
        for (let ch = 0; ch < 3; ch++) rgba[i * 4 + ch] = Math.max(0, Math.min(255, c[ch]! + (r() - 0.5) * 40));
        rgba[i * 4 + 3] = r() < 0.15 ? 0 : r() < 0.1 ? 100 + Math.floor(r() * 60) : 255;
      }
      expect(pieceColours(rgba)).toEqual(plain(rgba));
    }
    const few = new Uint8Array(S * S * 4);
    for (let i = 0; i < 19; i++) few[i * 2 * 4 + 3] = 255;
    expect(pieceColours(few)).toBeNull();
    expect(plain(few)).toBeNull();
  });
});

describe('evening out the light', () => {
  it('the table around a piece is found, and a piece in a darker spot is brightened to the usual light', () => {
    // A 200 × 200 photo: a table lit at (150, 150, 150), a grey piece of 40 × 40 px in the middle.
    const W = 200;
    const data = new Uint8Array(W * W * 4);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const inPiece = x >= 80 && x < 120 && y >= 80 && y < 120;
        data.set(inPiece ? [60, 50, 40, 255] : [150, 150, 150, 255], (y * W + x) * 4);
      }
    const outline = [80, 80, 120, 80, 120, 120, 80, 120];
    // Every 2 px along the square's sides, so the sampling has points to go from.
    const dense: number[] = [];
    for (let i = 0; i < 4; i++)
      for (let t = 0; t < 20; t++) {
        const [x0, y0, x1, y1] = [outline[2 * i]!, outline[2 * i + 1]!, outline[(2 * i + 2) % 8]!, outline[(2 * i + 3) % 8]!];
        dense.push(x0 + ((x1 - x0) * t) / 20, y0 + ((y1 - y0) * t) / 20);
      }
    const table = tableAround({ data, width: W, height: W, stride: W * 4 }, dense, 2)!;
    expect(table.map(Math.round)).toEqual([150, 150, 150]);
    // The same piece lit like a 200-grey table looks lighter, the same shape of colour.
    const patch = new Uint8Array([60, 50, 40, 255, 0, 0, 0, 0]);
    const lit = evenLight(patch, table, [200, 200, 200]);
    expect(lit[0]!).toBeGreaterThan(60);
    expect(lit[0]! > lit[1]! && lit[1]! > lit[2]!).toBe(true);
    expect([...lit.slice(4)]).toEqual([0, 0, 0, 0]);
    expect([...evenLight(patch, table, table)].slice(0, 3)).toEqual([60, 50, 40]);
  });

  it('evening out uses a table of the 256 values per channel: exactly the per-pixel sums (2026-11-10)', () => {
    const toLinear = (v: number) => {
      const t = v / 255;
      return t <= 0.04045 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4;
    };
    const toSrgb = (v: number) => Math.max(0, Math.min(255, 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055)));
    const rgba = new Uint8Array(64 * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37 + (i >> 2) * 11) % 256;
    for (let i = 3; i < rgba.length; i += 16) rgba[i] = 0;
    for (const [table, ref] of [
      [
        [150, 140, 120],
        [200, 196, 188],
      ],
      [
        [240, 250, 230],
        [100, 100, 100],
      ],
      [
        [0, 30, 255],
        [220, 210, 200],
      ],
    ]) {
      const gain = [0, 1, 2].map((c) => toLinear(ref![c]!) / Math.max(1e-4, toLinear(table![c]!)));
      const want = new Uint8Array(rgba);
      for (let i = 0; i < want.length; i += 4) if (want[i + 3]) for (let c = 0; c < 3; c++) want[i + c] = toSrgb(toLinear(rgba[i + c]!) * gain[c]!);
      expect(evenLight(rgba, table!, ref!)).toEqual(want);
    }
  });

  it('a neighbouring piece next to the table around is left out', () => {
    const W = 200;
    const data = new Uint8Array(W * W * 4);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++)
        data.set(x >= 80 && x < 120 && y >= 80 && y < 120 ? [60, 50, 40, 255] : x >= 122 ? [20, 20, 90, 255] : [180, 175, 170, 255], (y * W + x) * 4);
    const dense: number[] = [];
    const corners = [80, 80, 120, 80, 120, 120, 80, 120];
    for (let i = 0; i < 4; i++)
      for (let t = 0; t < 20; t++)
        dense.push(
          corners[2 * i]! + ((corners[(2 * i + 2) % 8]! - corners[2 * i]!) * t) / 20,
          corners[2 * i + 1]! + ((corners[(2 * i + 3) % 8]! - corners[2 * i + 1]!) * t) / 20,
        );
    expect(tableAround({ data, width: W, height: W, stride: W * 4 }, dense, 2)!.map(Math.round)).toEqual([180, 175, 170]);
    // Only the 4 corners given: points are added along the sides.
    expect(tableAround({ data, width: W, height: W, stride: W * 4 }, corners, 2)!.map(Math.round)).toEqual([180, 175, 170]);
  });
});

describe('grouping pieces by colour', () => {
  const dark: Lab = [20, 5, 5];
  const red: Lab = [45, 50, 30];
  const sky: Lab = [70, -5, -35];
  const jitter = (c: Lab, i: number): Lab => [c[0] + ((i * 7) % 5) - 2, c[1] + ((i * 3) % 5) - 2, c[2] + ((i * 11) % 5) - 2];
  const pieces = [
    ...Array.from({ length: 12 }, (_, i) => jitter(sky, i)),
    ...Array.from({ length: 8 }, (_, i) => jitter(dark, i)),
    ...Array.from({ length: 10 }, (_, i) => jitter(red, i)),
  ];

  it('three clear colours in three groups: each group is one of them, darkest first', () => {
    const g = groupColours(pieces, 3);
    expect(g).toHaveLength(3);
    expect(Math.sqrt(dist2(g[0]!, dark))).toBeLessThan(3);
    expect(Math.sqrt(dist2(g[1]!, red))).toBeLessThan(3);
    expect(Math.sqrt(dist2(g[2]!, sky))).toBeLessThan(3);
    // Every piece is in the group of its own colour.
    pieces.forEach((p, i) => expect(pieceGroup(g, { main: p, second: null, secondShare: 0 }).group).toBe(i < 12 ? 2 : i < 20 ? 0 : 1));
  });

  it('the same pieces in any order give the same groups (letters never jump around)', () => {
    const a = groupColours(pieces, 3);
    const b = groupColours(pieces.slice().reverse(), 3);
    expect(b).toHaveLength(3);
    a.forEach((c, i) => expect(Math.sqrt(dist2(c, b[i]!))).toBeLessThan(1));
  });

  it('fewer distinct colours than trays: fewer groups', () => {
    expect(groupColours([dark, dark, sky, sky, sky], 6)).toHaveLength(2);
    expect(groupColours([], 6)).toEqual([]);
  });

  it('a piece with a lot of a second colour mentions that group ("+B")', () => {
    const g = groupColours(pieces, 3);
    expect(pieceGroup(g, { main: sky, second: red, secondShare: 0.4 })).toEqual({ group: 2, also: 1 });
    expect(pieceGroup(g, { main: sky, second: red, secondShare: 0.1 })).toEqual({ group: 2, also: null });
    expect(pieceGroup(g, { main: sky, second: jitter(sky, 3), secondShare: 0.45 })).toEqual({ group: 2, also: null });
  });

  it('shows a group in its colour, with readable letters', () => {
    expect(labToHex(labOf([200, 30, 40]))).toBe('#c81e28');
    expect(labToHex([100, 0, 0])).toBe('#ffffff');
    expect(inkOn(dark)).toBe('#fff');
    expect(inkOn(sky)).toBe('#000');
  });
});
