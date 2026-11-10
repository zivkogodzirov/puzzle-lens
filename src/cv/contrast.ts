/**
 * Table-contrast check (M4, PLAN §7 "Box setup"): which parts of the box picture are close to the
 * table's colour. Pieces from there stand out little from the table, so a scan may miss them or
 * cut their outlines short (RESEARCH §6, pale pieces on a white table).
 *
 * The table's colour comes from the scans (measured around the pieces), moved into the box
 * picture's colours with the colour match placement measured (pieces' photos → box picture).
 */
import { applyColourMatch, type ColourMatch } from './placement';

export type Lab = [number, number, number];

export const CONTRAST = {
  /** A box picture pixel this close to the table's colour (ΔE, CIE76) counts as hard to see. */
  maxDE: 14,
  /** A spot counts as hard to see when this share of it is. */
  cellShare: 0.5,
  /** Worth a warning from this share of the picture on (the owner's The Kiss on a white table: 1.4 %, the white lace and collar). */
  warnShare: 0.02,
};

/** The table's colour moved into the box picture's colours (unchanged without a colour match). */
export function tableInBox(table: Lab, match: ColourMatch | null): Lab {
  if (!match) return table;
  // The learned transform (M8), when there is one.
  if (match.affine?.length === 12) {
    const v = Float32Array.from(table);
    applyColourMatch(v, match);
    return [v[0]!, v[1]!, v[2]!];
  }
  return [0, 1, 2].map((c) => ((table[c]! - match.from.mean[c]!) / Math.max(1e-6, match.from.std[c]!)) * match.to.std[c]! + match.to.mean[c]!) as Lab;
}

/**
 * Per spot (row by row), the share of its pixels within CONTRAST.maxDE of the table's colour.
 * `boxLab`: the box picture in Lab, cols × cell by rows × cell pixels.
 */
export function closeToTable(boxLab: Float32Array, cols: number, rows: number, cell: number, table: Lab): Float32Array {
  const out = new Float32Array(cols * rows);
  const w = cols * cell;
  const max2 = CONTRAST.maxDE ** 2;
  const per = 1 / (cell * cell);
  for (let y = 0; y < rows * cell; y++)
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 3;
      const d = (boxLab[k]! - table[0]) ** 2 + (boxLab[k + 1]! - table[1]) ** 2 + (boxLab[k + 2]! - table[2]) ** 2;
      if (d <= max2) out[Math.floor(y / cell) * cols + Math.floor(x / cell)]! += per;
    }
  return out;
}

/** How many spots are hard to see (share of the picture). */
export function hardShare(close: Float32Array): number {
  let n = 0;
  for (const v of close) if (v >= CONTRAST.cellShare) n++;
  return close.length ? n / close.length : 0;
}

/** Mean and spread of a Lab image (for the colour match of the box picture). */
export function labStatsOf(lab: Float32Array): { mean: Lab; std: Lab } {
  const n = lab.length / 3;
  const s = [0, 0, 0];
  const q = [0, 0, 0];
  for (let i = 0; i < lab.length; i += 3)
    for (let c = 0; c < 3; c++) {
      s[c]! += lab[i + c]!;
      q[c]! += lab[i + c]! ** 2;
    }
  const mean = s.map((v) => v / n) as Lab;
  const std = q.map((v, c) => Math.max(1, Math.sqrt(Math.max(0, v / n - mean[c]! ** 2)))) as Lab;
  return { mean, std };
}
