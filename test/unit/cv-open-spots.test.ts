/**
 * Leftover pieces into the empty spots (src/cv/openSpots.ts, src/cv/assign.ts): the photo of the
 * nearly finished puzzle may be turned compared with the box picture; one piece per spot; chances.
 */
import { describe, expect, it } from 'vitest';
import { bestAssignment, pairChances } from '../../src/cv/assign';
import { chooseSpots, orientSpots, straightenQuad, turnCell } from '../../src/cv/openSpots';
import { buildBoxGrid, PLACE, type Placement } from '../../src/cv/placement';
import { generatePuzzle } from '../synth/index';

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

describe('turning the empty spots', () => {
  it('turnCell: a quarter turn clockwise moves the top-left to the top-right; four turns change nothing', () => {
    expect(turnCell(0, 0, 5, 3, 1)).toEqual([2, 0]);
    expect(turnCell(4, 0, 5, 3, 1)).toEqual([2, 4]);
    expect(turnCell(0, 0, 5, 3, 2)).toEqual([4, 2]);
    expect(turnCell(0, 0, 5, 3, 3)).toEqual([0, 4]);
    for (let t = 0; t < 4; t++)
      for (const [c, r] of [
        [0, 0],
        [3, 1],
        [4, 2],
      ] as const) {
        // Turning by t then by 4 − t (on the turned grid) comes back.
        const [dims, back] = t % 2 ? [[3, 5], 4 - t] : [[5, 3], (4 - t) % 4];
        expect(turnCell(...turnCell(c, r, 5, 3, t), dims[0]!, dims[1]!, back)).toEqual([c, r]);
      }
  });

  // A 7 × 9 puzzle (not square: only two turns fit each photo shape).
  const pz = generatePuzzle({ cols: 7, rows: 9, cellMm: [17.8, 19.4], seed: 11 });
  const art = { data: pz.art.rgba, width: pz.art.width, height: pz.art.height, stride: pz.art.width * 4 };
  const box = buildBoxGrid(art, pz.cols, pz.rows);
  const gapsBox: Array<[number, number]> = [
    [5, 0],
    [6, 0],
    [5, 1],
    [2, 4],
    [3, 4],
  ];

  /** The puzzle photographed turned t quarter turns clockwise, gaps showing the white table, straightened. */
  function photoTurned(t: number) {
    const W = art.width;
    const H = art.height;
    const [w, h] = t % 2 ? [H, W] : [W, H];
    const out = new Uint8Array(w * h * 4);
    const cw = W / pz.cols;
    const ch = H / pz.rows;
    const gap = new Set(gapsBox.map(([c, r]) => `${c},${r}`));
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const [tx, ty] = turnCell(x, y, W, H, t);
        const k = (y * W + x) * 4;
        const o = (ty * w + tx) * 4;
        const white = gap.has(`${Math.floor(x / cw)},${Math.floor(y / ch)}`);
        for (let c = 0; c < 3; c++) out[o + c] = white ? 235 : art.data[k + c]!;
        out[o + 3] = 255;
      }
    const [cols, rows] = t % 2 ? [pz.rows, pz.cols] : [pz.cols, pz.rows];
    // As the reader does it: the puzzle's corners in the photo, straightened 8 px per cell.
    const photo = { data: out, width: w, height: h, stride: w * 4 };
    const thumb = straightenQuad(
      photo,
      [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ],
      cols * 8,
      rows * 8,
    );
    return { thumb, cols, rows, gaps: gapsBox.map(([c, r]) => turnCell(c, r, pz.cols, pz.rows, t)) };
  }

  for (const t of [0, 1, 2, 3])
    it(`a photo turned ${t} quarter turn(s) clockwise: its spots are turned back to the box picture's`, () => {
      const ph = photoTurned(t);
      const o = orientSpots(box, ph.thumb, ph.cols, ph.rows, ph.gaps)!;
      expect(o).not.toBeNull();
      expect(o.turn).toBe((4 - t) % 4);
      expect(o.cells).toEqual(gapsBox);
      expect(o.fit).toBeGreaterThan(o.runnerUp + 0.3);
    });

  it('a photo whose grid fits the box picture in no turn gives null', () => {
    const ph = photoTurned(0);
    expect(orientSpots(box, ph.thumb, 8, 9, ph.gaps)).toBeNull();
  });
});

describe('one piece per spot', () => {
  /** Best total by trying every pairing (pieces may stay unpaired). */
  function brute(score: number[][], minScore: number): number {
    const P = score.length;
    const S = score[0]!.length;
    let best = 0;
    const used = new Array<boolean>(S).fill(false);
    const go = (i: number, tot: number) => {
      if (i === P) return void (best = Math.max(best, tot));
      go(i + 1, tot);
      for (let j = 0; j < S; j++)
        if (!used[j] && score[i]![j]! > minScore) {
          used[j] = true;
          go(i + 1, tot + score[i]![j]! - minScore);
          used[j] = false;
        }
    };
    go(0, 0);
    return best;
  }

  it('bestAssignment finds the best total (pieces and spots may stay unpaired), each spot used once', () => {
    const r = rng(3);
    for (let k = 0; k < 60; k++) {
      const P = 1 + Math.floor(r() * 5);
      const S = 1 + Math.floor(r() * 5);
      const score = Array.from({ length: P }, () => Array.from({ length: S }, () => r() * 1.4 - 0.6));
      const minScore = -0.2;
      const a = bestAssignment(score, minScore);
      const usedSpots = a.filter((j) => j >= 0);
      expect(new Set(usedSpots).size).toBe(usedSpots.length);
      const tot = a.reduce((s, j, i) => s + (j >= 0 ? score[i]![j]! - minScore : 0), 0);
      expect(tot).toBeCloseTo(brute(score, minScore), 9);
    }
  });

  it('a spot that can’t take a piece (no score) is never given to it', () => {
    const a = bestAssignment(
      [
        [Number.NEGATIVE_INFINITY, 0.1],
        [0.9, 0.8],
      ],
      -0.2,
    );
    expect(a).toEqual([1, 0]);
  });

  it('pairChances: each piece and each spot adds up to at most 1, and a clear match is sure', () => {
    const score = [
      [0.8, 0.1, 0.0],
      [0.1, 0.7, 0.65],
      [0.0, 0.6, 0.66],
    ];
    const ch = pairChances(score, -0.2, 0.04);
    for (const row of ch) expect(row.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1 + 1e-6);
    for (let j = 0; j < 3; j++) expect(ch.reduce((a, row) => a + row[j]!, 0)).toBeLessThanOrEqual(1 + 1e-6);
    expect(ch[0]![0]).toBeGreaterThan(0.95);
    // Pieces 2 and 3 compete for spots 2 and 3: neither is sure.
    expect(ch[1]![1]).toBeLessThan(0.9);
    expect(ch[1]![1]).toBeGreaterThan(0.5);
  });

  it('chooseSpots: two pieces liking the same spot get different spots; a non-piece fits none', () => {
    const cells: Array<[number, number]> = [
      [3, 0],
      [4, 0],
    ];
    const pl = (s: [number, number]): Placement => ({
      top: cells.map(([col, row], j) => ({ col, row, rot: 0, score: s[j]!, p: 0 })),
      verdict: 'several',
    });
    const got = chooseSpots(
      [
        { id: 'a', placement: pl([0.7, 0.6]) },
        { id: 'b', placement: pl([0.72, 0.2]) },
        { id: 'label', placement: pl([PLACE.gapMinScore - 0.2, PLACE.gapMinScore - 0.3]) },
      ],
      cells,
    );
    expect(got.get('b')!.placement.top[0]).toMatchObject({ col: 3, row: 0 });
    expect(got.get('a')!.placement.top[0]).toMatchObject({ col: 4, row: 0 });
    expect(got.get('a')!.fits && got.get('b')!.fits).toBe(true);
    expect(got.get('label')!.fits).toBe(false);
    expect(got.get('label')!.placement.verdict).toBe('several');
  });

  it('knob fit: equal-looking pieces go where their knobs fit the hole and each other', () => {
    // Two spots side by side; the left one's hole shows a knob out on its left. Pieces A and B look
    // the same everywhere (equal scores, upright only); A has a knob out on its left, B a knob in.
    const cells: Array<[number, number]> = [
      [5, 5],
      [6, 5],
    ];
    const NEG = Number.NEGATIVE_INFINITY;
    const pl = (): Placement => ({
      top: cells.map(([col, row]) => ({ col, row, rot: 0, score: 0.4, p: 0, rotScores: [0.4, NEG, NEG, NEG] })),
      verdict: 'several',
    });
    const placed = [
      { id: 'B', placement: pl() },
      { id: 'A', placement: pl() },
    ];
    const shapes = {
      // Sides: top, right, bottom, left.
      pieces: new Map([
        ['A', { sides: 'utut', conf: [1, 1, 1, 1] }],
        ['B', { sides: 'uuub', conf: [1, 1, 1, 1] }],
      ]),
      spots: ['?o?t', '???o'],
    };
    const got = chooseSpots(placed, cells, shapes);
    expect(got.get('A')!.placement.top[0]).toMatchObject({ col: 5, row: 5 });
    expect(got.get('B')!.placement.top[0]).toMatchObject({ col: 6, row: 5 });
    expect(got.get('A')!.placement.top[0]!.p).toBeGreaterThan(got.get('A')!.placement.top[1]!.p);
    // The other way round, A's knob out would meet the hole's knob out: never preferred.
    const swapped = chooseSpots(placed, cells, { ...shapes, spots: ['?o?b', '???o'] });
    expect(swapped.get('B')!.placement.top[0]).toMatchObject({ col: 5, row: 5 });
  });
});
