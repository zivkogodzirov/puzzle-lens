/**
 * Grid suggestion (src/project/grid.ts, RESEARCH §10).
 */
import { describe, expect, it } from 'vitest';
import { checkManualGrid, COUNT_WINDOW, describeGrid, MAX_CELL_ASPECT, suggestGrids, topGrids } from '../../src/project/grid';

function inWindow(count: number, n: number): boolean {
  return count >= Math.ceil(n * (1 - COUNT_WINDOW.below) - 1e-9) && count <= Math.floor(n * (1 + COUNT_WINDOW.above) + 1e-9);
}

describe('Ravensburger 1000 (36 × 28 = 1008)', () => {
  it('portrait picture (0.74) → 28 across × 36 down', () => {
    const [best] = topGrids(1000, 0.74);
    expect(best).toMatchObject({ cols: 28, rows: 36, count: 1008, known: 'Ravensburger' });
  });

  it('landscape picture (1.35) → 36 across × 28 down', () => {
    const [best] = topGrids(1000, 1.35);
    expect(best).toMatchObject({ cols: 36, rows: 28, count: 1008 });
  });

  it("the real picture's shape (699 × 497 mm ≈ 1.406) still picks 36 × 28, not 37 × 27 or 38 × 27", () => {
    expect(topGrids(1000, 699 / 497)[0]).toMatchObject({ cols: 36, rows: 28 });
    expect(topGrids(1000, 497 / 699)[0]).toMatchObject({ cols: 28, rows: 36 });
  });

  it('the other two suggestions are the closest other layouts', () => {
    const top = topGrids(1000, 1.35);
    expect(top).toHaveLength(3);
    const names = top.map((g) => `${g.cols}x${g.rows}`);
    expect(names).toContain('37x27');
    for (const g of top) expect(inWindow(g.count, 1000)).toBe(true);
  });

  it('includes the layouts RESEARCH §10 lists, for a landscape picture', () => {
    const all = suggestGrids(1000, 1.45).map((g) => `${g.cols}x${g.rows}`);
    for (const l of ['36x28', '37x27', '38x27', '39x26']) expect(all).toContain(l);
  });

  it('a picture far from 36 × 28 loses the known-layout bonus', () => {
    const [best] = topGrids(1000, 1.6);
    expect(best!.known).toBeNull();
    expect(best).toMatchObject({ cols: 40, rows: 25 });
  });
});

describe('other counts', () => {
  const cases: Array<[number, number]> = [
    [500, 1.4],
    [500, 0.71],
    [1500, 1.4],
    [1500, 0.7],
    [2000, 1.45],
    [2000, 0.69],
    [999, 1.3],
    [750, 1.33],
    [101, 1.5],
    [1001, 1],
    [24, 1.5],
    [3000, 1.4],
  ];
  for (const [n, aspect] of cases) {
    it(`${n} pieces, picture ${aspect}: all suggestions within −2 %…+6 %, cell aspect ≤ 1.35, orientation follows the picture`, () => {
      const all = suggestGrids(n, aspect);
      expect(all.length).toBeGreaterThan(0);
      for (const g of all) {
        expect(g.count).toBe(g.cols * g.rows);
        expect(inWindow(g.count, n)).toBe(true);
        expect(Math.max(g.cellAspect, 1 / g.cellAspect)).toBeLessThanOrEqual(MAX_CELL_ASPECT + 1e-9);
      }
      const best = all[0]!;
      if (aspect > 1.05) expect(best.cols).toBeGreaterThan(best.rows);
      if (aspect < 0.95) expect(best.cols).toBeLessThan(best.rows);
      // Sorted best first.
      for (let i = 1; i < all.length; i++) expect(all[i]!.score).toBeGreaterThanOrEqual(all[i - 1]!.score);
    });
  }

  it('500 at 1.4 suggests a sensible grid near 26 × 19', () => {
    const [best] = topGrids(500, 1.4);
    expect(Math.abs(best!.cols / best!.rows - 1.4)).toBeLessThan(0.12);
    expect(Math.abs(best!.countError)).toBeLessThan(0.03);
  });

  it('2000 at 1.45 stays close to the picture shape', () => {
    const [best] = topGrids(2000, 1.45);
    expect(Math.abs(Math.log(best!.cols / best!.rows / 1.45))).toBeLessThan(0.06);
  });

  it('works without a picture shape (assumes landscape)', () => {
    const all = topGrids(1000, null);
    expect(all.length).toBe(3);
    expect(all[0]).toMatchObject({ cols: 36, rows: 28 });
    for (const g of all) expect(g.cols).toBeGreaterThanOrEqual(g.rows);
  });

  it('very small or odd counts widen the limits rather than offering nothing', () => {
    expect(suggestGrids(7, 1).length).toBeGreaterThan(0);
    expect(suggestGrids(13, 1.3).length).toBeGreaterThan(0);
  });

  it('nonsense input gives nothing', () => {
    expect(suggestGrids(0, 1.4)).toEqual([]);
    expect(suggestGrids(Number.NaN, 1.4)).toEqual([]);
  });
});

describe('words and manual entry', () => {
  it('describes a grid in plain English', () => {
    expect(describeGrid({ cols: 28, rows: 36 })).toBe('28 across × 36 down = 1008 pieces');
  });

  it('checks typed grids', () => {
    expect(checkManualGrid(28, 36, 1000)).toBeNull();
    expect(checkManualGrid(1, 36, 1000)).toMatch(/whole numbers/);
    expect(checkManualGrid(2.5, 36, 1000)).toMatch(/whole numbers/);
    expect(checkManualGrid(10, 10, 1000)).toMatch(/far from/);
    expect(checkManualGrid(300, 4, 1000)).toMatch(/200/);
  });
});
