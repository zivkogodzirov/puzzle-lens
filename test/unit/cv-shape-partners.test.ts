/**
 * Shape-only partner ranking (PLAN M3 tests; the owner's question 2026-11-08: "can it be solved
 * from the shapes alone, even face down?"). Synthetic generator pieces, outlines roughened like a
 * traced photo; for every tab side, all blank sides of all other pieces are ranked by
 * sideDistance and the rank of its true partner is recorded.
 *
 * The 10 × 8 run is a regular test; the full 28 × 36 report is opt-in:
 *   SHAPE_PARTNERS=1 npx vitest run --project unit test/unit/cv-shape-partners.test.ts
 *
 * Measured 2026-11-08 (28 × 36, 1952 joins, all blank sides as candidates): close-up quality top-1
 * 37 %, top-5 63 %, median rank 3; overview quality top-1 7 %, top-5 19 %; rough overview ~1 %.
 *
 * Caveat: generator knobs (deliberately alike: wrong blanks fit within 0.1–0.2 mm), not
 * Ravensburger's real cut. The go/no-go on your real pieces (a 7 × 7
 * block photographed whole, then scanned apart) decides.
 */
import { describe, expect, it } from 'vitest';
import { readShape, sideDistance, type SideRead } from '../../src/cv/shapeRead';
import { generatePuzzle, type SynthPuzzle } from '../synth/index';

const cell: [number, number] = [17.8, 19.4];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** Every `keep`-th point, jitter of about `sd` mm. */
function roughen(o: number[], keep: number, sd: number, r: () => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < o.length; i += 2 * keep) out.push(o[i]! + (r() + r() + r() - 1.5) * 2 * sd, o[i + 1]! + (r() + r() + r() - 1.5) * 2 * sd);
  return out;
}

/** Each piece's read sides keyed by the truth's top/right/bottom/left (the outlines are not rotated here). */
function readPuzzle(pz: SynthPuzzle, keep: number, sd: number, seed: number) {
  const r = rng(seed);
  const map = new Map<string, Array<SideRead | null>>();
  for (const p of pz.pieces) {
    const read = readShape(roughen(p.outlineMm, keep, sd, r), cell);
    const bySide: Array<SideRead | null> = [null, null, null, null];
    if (read) {
      const c = read.corners;
      const cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4;
      const cy = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4;
      for (let k = 0; k < 4; k++) {
        const a = c[k]!;
        const b = c[(k + 1) % 4]!;
        const dx = (a[0] + b[0]) / 2 - cx;
        const dy = (a[1] + b[1]) / 2 - cy;
        const i = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
        bySide[i] = read.sides[k]!;
      }
    }
    map.set(p.id, bySide);
  }
  return map;
}

function rankPartners(pz: SynthPuzzle, keep: number, sd: number, seed: number) {
  const reads = readPuzzle(pz, keep, sd, seed);
  const blanks: Array<{ id: string; side: SideRead }> = [];
  for (const p of pz.pieces) reads.get(p.id)!.forEach((s, k) => s && p.sides[k] === 'blank' && blanks.push({ id: p.id, side: s }));
  const ranks: number[] = [];
  for (const p of pz.pieces)
    for (const k of [1, 2]) {
      // Right ↔ the next piece's left; bottom ↔ the piece below's top.
      const q = pz.pieces.find((x) => (k === 1 ? x.row === p.row && x.col === p.col + 1 : x.col === p.col && x.row === p.row + 1));
      if (!q) continue;
      const [tabP, tabK, blankP, blankK] = p.sides[k] === 'tab' ? [p, k, q, (k + 2) % 4] : [q, (k + 2) % 4, p, k];
      const a = reads.get(tabP.id)![tabK];
      const b = reads.get(blankP.id)![blankK];
      if (!a || !b) {
        ranks.push(Infinity);
        continue;
      }
      const dTrue = sideDistance(a, b);
      let rank = 1;
      for (const c of blanks) if (c.id !== tabP.id && c.side !== b && sideDistance(a, c.side) < dTrue) rank++;
      ranks.push(rank);
    }
  ranks.sort((x, y) => x - y);
  const n = ranks.length;
  return { n, top1: ranks.filter((r) => r === 1).length / n, top5: ranks.filter((r) => r <= 5).length / n, median: ranks[n >> 1]!, candidates: blanks.length };
}

describe('shape-only partner ranking (synthetic)', () => {
  it('10 × 8, close-up quality (0.1 mm points, 0.08 mm noise): the true partner is first for ~70 % of sides, top 5 for ~90 %', () => {
    const pz = generatePuzzle({ cols: 10, rows: 8, cellMm: cell, seed: 21 });
    const r = rankPartners(pz, 1, 0.08, 1);
    console.log(
      `10×8 close-up: ${r.n} joins, ${r.candidates} blank sides; top-1 ${(100 * r.top1).toFixed(1)} %, top-5 ${(100 * r.top5).toFixed(1)} %, median rank ${r.median}`,
    );
    expect(r.top1).toBeGreaterThanOrEqual(0.65);
    expect(r.top5).toBeGreaterThanOrEqual(0.85);
  });

  it.skipIf(process.env.SHAPE_PARTNERS !== '1')(
    '28 × 36 report at close-up and overview quality',
    () => {
      const pz = generatePuzzle({ cols: 28, rows: 36, cellMm: cell, seed: 33 });
      for (const [label, keep, sd] of [
        ['close-up', 1, 0.08],
        ['overview', 2, 0.15],
        ['rough overview', 3, 0.25],
      ] as const) {
        const r = rankPartners(pz, keep, sd, 2);
        console.log(
          `28×36 ${label}: ${r.n} joins, ${r.candidates} blank sides; top-1 ${(100 * r.top1).toFixed(1)} %, top-5 ${(100 * r.top5).toFixed(1)} %, median rank ${r.median}`,
        );
      }
    },
    600_000,
  );
});
