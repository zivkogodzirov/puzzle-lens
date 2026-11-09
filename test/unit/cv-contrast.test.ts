/**
 * Table-contrast check (src/cv/contrast.ts): parts of the box picture close to the table's colour.
 */
import { describe, expect, it } from 'vitest';
import { closeToTable, hardShare, labStatsOf, tableInBox, type Lab } from '../../src/cv/contrast';

describe('table contrast', () => {
  // A 4 × 2 picture at 2 px per spot: the first column white like the table, the rest dark.
  const cols = 4;
  const rows = 2;
  const cell = 2;
  const lab = new Float32Array(cols * cell * rows * cell * 3);
  for (let y = 0; y < rows * cell; y++) for (let x = 0; x < cols * cell; x++) lab.set(x < cell ? [92, 0, 3] : [30, 10, 20], (y * cols * cell + x) * 3);
  const table: Lab = [90, 0, 2];

  it('spots in the table’s colour are found; the share counts whole spots', () => {
    const close = closeToTable(lab, cols, rows, cell, table);
    expect([...close]).toEqual([1, 0, 0, 0, 1, 0, 0, 0]);
    expect(hardShare(close)).toBeCloseTo(2 / 8, 9);
  });

  it('the table’s colour is moved into the box picture’s colours before comparing', () => {
    // The pieces' photos are 10 lighter than the box picture: the table (photographed at 100) is 90 in the box.
    const match = { from: { mean: [60, 0, 0] as Lab, std: [10, 5, 5] as Lab }, to: { mean: [50, 0, 0] as Lab, std: [10, 5, 5] as Lab } };
    expect(tableInBox([100, 0, 2], match)).toEqual([90, 0, 2]);
    expect(tableInBox([100, 0, 2], null)).toEqual([100, 0, 2]);
    expect(hardShare(closeToTable(lab, cols, rows, cell, tableInBox([100, 0, 2], match)))).toBeCloseTo(0.25, 9);
  });

  it('a picture’s colour statistics', () => {
    const st = labStatsOf(lab);
    expect(st.mean[0]).toBeCloseTo((92 + 3 * 30) / 4, 4);
    expect(st.std[0]).toBeGreaterThan(20);
  });
});
