/**
 * Colour groups for trays (src/cv/colourGroups.ts): a piece's main colour (and a second one), and
 * pieces grouped by colour, darkest group first.
 */
import { describe, expect, it } from 'vitest';
import { dist2, GROUPS, groupColours, inkOn, labToHex, pieceColours, pieceGroup, type Lab } from '../../src/cv/colourGroups';
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
    const a = groupColours(pieces, 4);
    const b = groupColours(pieces.slice().reverse(), 4);
    expect(b).toHaveLength(4);
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
