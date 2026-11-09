import { describe, expect, it } from 'vitest';
import type { SpotChoice } from '../../src/cv/openSpots';
import {
  blockSuggestions,
  calibratePair,
  confirmedPairs,
  PAIR_CALIBRATION,
  pairHealth,
  pairKey,
  pairModel,
  pairSuggestions,
  PAIRS,
} from '../../src/project/pairs';
import type { PieceRow } from '../../src/project/types';

const GRID = { cols: 6, rows: 5 };

/** A piece's spots: [col, row, chance, turn?]. */
function choice(...spots: Array<[number, number, number, (0 | 1 | 2 | 3)?]>): SpotChoice {
  return {
    placement: { top: spots.map(([col, row, p, rot]) => ({ col, row, p, rot: rot ?? 0, score: 1 })), verdict: 'likely' },
    fits: true,
  } as unknown as SpotChoice;
}

function row(id: string, sides?: string, conf = [1, 1, 1, 1]): PieceRow {
  return {
    id,
    projectId: 'p',
    status: 'table',
    patch: sides ? { blobId: '', flats: [], sure: true, ts: 1, sides, sideConf: conf } : null,
  } as unknown as PieceRow;
}

describe('pairKey', () => {
  it('names a join the same from either piece', () => {
    expect(pairKey('a', 'b', 1)).toBe('a|b|1');
    expect(pairKey('b', 'a', 3)).toBe('a|b|1');
    expect(pairKey('a', 'b', 2)).toBe('a|b|2');
    expect(pairKey('b', 'a', 0)).toBe('a|b|2');
  });
});

describe('pairModel', () => {
  it('two pieces sure of neighbouring spots join; the rest of each side is "not scanned yet", edge or "in the puzzle"', () => {
    const shown = new Map([
      ['a', choice([0, 2, 0.9], [4, 4, 0.1])],
      ['b', choice([1, 2, 0.8])],
    ]);
    const m = pairModel({ shown, rows: [row('a'), row('b')], grid: GRID, calibrate: false });
    const right = m.sides.get('a')![1];
    expect(right.partners.map((q) => q.id)).toEqual(['b']);
    expect(right.partners[0]!.p).toBeCloseTo(0.72);
    expect(right.partners[0]).toMatchObject({ col: 1, row: 2 });
    expect(right.notScanned).toBeCloseTo(0.9 * 0.2 + 0.1);
    expect(right.edge).toBe(0);
    // Left of col 0 is the edge (90 %); left of (4, 4) has nobody (10 %).
    const left = m.sides.get('a')![3];
    expect(left.edge).toBeCloseTo(0.9);
    expect(left.notScanned).toBeCloseTo(0.1);
    // From b: a is on its left, with the same chance.
    expect(m.sides.get('b')![3].partners[0]!.p).toBeCloseTo(0.72);
    expect(m.sides.get('b')![3].unsure).toBeCloseTo(0.2);
    // The join once, as "a | b | right".
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0]).toMatchObject({ a: 'a', b: 'b', dir: 1, col: 0, row: 2 });
    expect(pairSuggestions(m).length).toBe(1);
    expect(pairSuggestions(m, 0.8).length).toBe(0);
  });

  it('shares a spot out when the pieces there claim more than all of it', () => {
    const shown = new Map([
      ['a', choice([2, 2, 1])],
      ['b', choice([3, 2, 0.8])],
      ['c', choice([3, 2, 0.8])],
    ]);
    const m = pairModel({ shown, rows: [row('a'), row('b'), row('c')], grid: GRID, calibrate: false });
    const right = m.sides.get('a')![1];
    expect(right.partners.map((q) => q.p)).toEqual([0.5, 0.5]);
    expect(right.notScanned).toBeCloseTo(0);
  });

  it('a spot already filled in the puzzle is "joins the puzzle", among empty spots and for placed pieces', () => {
    const shown = new Map([['a', choice([2, 2, 1])]]);
    const open = new Set(['2,2', '2,3']);
    const m = pairModel({ shown, rows: [row('a')], grid: GRID, calibrate: false, open, filled: new Set(['2,3']) });
    const s = m.sides.get('a')!;
    expect(s[0].inPuzzle).toBe(1); // (2, 1) isn't empty
    expect(s[2].inPuzzle).toBe(1); // (2, 3) was filled since
    expect(s[1].inPuzzle).toBe(1);
    expect(s[1].notScanned).toBe(0);
  });

  it('shape rules a pair out only when both facing sides are read clearly', () => {
    const save = PAIRS.vetoConf;
    PAIRS.vetoConf = 0.6;
    try {
      const shown = new Map([
        ['a', choice([1, 1, 1])],
        ['b', choice([2, 1, 1])],
      ]);
      // a's right side and b's left side are both knobs out.
      const both = pairModel({ shown, rows: [row('a', 'btbb'), row('b', 'bbbt')], grid: GRID, calibrate: false });
      // Among empty spots the veto is off by default (the placement weighs knob fit already).
      expect(pairModel({ shown, rows: [row('a', 'btbb'), row('b', 'bbbt')], grid: GRID, calibrate: false, open: new Set(['1,1', '2,1']) }).pairs).toHaveLength(
        1,
      );
      expect(both.pairs).toHaveLength(0);
      expect(both.sides.get('a')![1].notScanned).toBe(1);
      // b's left side read unsurely: kept.
      const unsure = pairModel({ shown, rows: [row('a', 'btbb'), row('b', 'bbbt', [1, 1, 1, 0.3])], grid: GRID, calibrate: false });
      expect(unsure.pairs).toHaveLength(1);
      expect(unsure.pairs[0]!.shape).toBe('unknown');
      // Knob out against knob in: kept, and said so.
      const fits = pairModel({ shown, rows: [row('a', 'btbb'), row('b', 'tttb')], grid: GRID, calibrate: false });
      expect(fits.pairs[0]!.shape).toBe('fits');
      // b turned a quarter: its left side is then its patch's bottom (a knob in).
      const turned = pairModel({
        shown: new Map([
          ['a', choice([1, 1, 1])],
          ['b', choice([2, 1, 1, 1])],
        ]),
        rows: [row('a', 'btbb'), row('b', 'ttbt')],
        grid: GRID,
        calibrate: false,
      });
      expect(turned.pairs[0]!.shape).toBe('fits');
    } finally {
      PAIRS.vetoConf = save;
    }
  });

  it('leaves out pairs the owner said don’t join', () => {
    const shown = new Map([
      ['a', choice([1, 1, 1])],
      ['b', choice([1, 2, 1])],
    ]);
    const m = pairModel({ shown, rows: [row('a'), row('b')], grid: GRID, calibrate: false, not: new Set([pairKey('b', 'a', 0)]) });
    expect(m.pairs).toHaveLength(0);
    expect(m.sides.get('a')![2].notScanned).toBe(1);
  });
});

describe('2 × 2 squares', () => {
  const shown = new Map([
    ['tl', choice([1, 1, 0.9])],
    ['tr', choice([2, 1, 0.9])],
    ['bl', choice([1, 2, 0.9])],
    ['br', choice([2, 2, 0.6])],
    ['x', choice([4, 4, 1])],
  ]);
  const rows = ['tl', 'tr', 'bl', 'br', 'x'].map((id) => row(id));

  it('four pairs that agree on the spots close a square, and confirm its pairs', () => {
    const m = pairModel({ shown, rows, grid: GRID, calibrate: false });
    const blocks = blockSuggestions(pairSuggestions(m), 0.5);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ ids: ['tl', 'tr', 'bl', 'br'], col: 1, row: 1 });
    expect(blocks[0]!.p).toBeCloseTo(0.54);
    // Only from pairs at least that likely (PAIRS.blockMinP for the mode).
    expect(blockSuggestions(pairSuggestions(m), 0.6)).toHaveLength(0);
    expect([...confirmedPairs(blocks)].sort()).toEqual(['bl|br|1', 'tl|bl|2', 'tl|tr|1', 'tr|br|2']);
  });

  it('no square when one of its pairs is missing', () => {
    const m = pairModel({ shown, rows, grid: GRID, calibrate: false, not: new Set([pairKey('tr', 'br', 2)]) });
    expect(blockSuggestions(pairSuggestions(m), 0.5)).toHaveLength(0);
  });

  it('health: candidates at least half as likely as the best, per side', () => {
    const m = pairModel({ shown, rows, grid: GRID, calibrate: false });
    expect(pairHealth(m)).toEqual({ sides: 8, mean: 1 });
  });
});

describe('measured chances', () => {
  it('maps raw chances through the measured points, and takes the extra from "not scanned yet"', () => {
    const save = PAIR_CALIBRATION.whole;
    PAIR_CALIBRATION.whole = [
      [0, 0],
      [0.5, 0.8],
      [1, 1],
    ];
    try {
      expect(calibratePair(0.25, 'whole')).toBeCloseTo(0.4);
      expect(calibratePair(0.75, 'whole')).toBeCloseTo(0.9);
      const shown = new Map([
        ['a', choice([1, 1, 1])],
        ['b', choice([2, 1, 0.5])],
      ]);
      const m = pairModel({ shown, rows: [row('a'), row('b')], grid: GRID });
      const right = m.sides.get('a')![1];
      expect(right.partners[0]!.p).toBeCloseTo(0.8);
      expect(right.notScanned).toBeCloseTo(0.2);
      expect(m.pairs[0]!.p).toBeCloseTo(0.8);
    } finally {
      PAIR_CALIBRATION.whole = save;
    }
  });
});
