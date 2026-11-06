/**
 * The yardstick for piece detection (PLAN §7 "Segmentation" and "Position"): per-piece recall and
 * precision with IoU ≥ 0.85 against the TRUE TOP FACE, plus the piece-centre error in table mm.
 *
 * - "Should be found": pieces whose top face is ≥ 99 % visible (inside the photo, not under a
 *   card), face up and (by default) not part of a deliberate touching pair.
 * - A detection that best overlaps an ineligible piece (partly outside, face down, touching) is
 *   neither a hit nor a false positive: it is ignored.
 * - Matching is one-to-one, greedy by IoU.
 * - Position: centroid of the found top face vs centroid of the true top face, both mapped to the
 *   table through the top-face plane (truth.topToImg), in mm.
 */
import { applyH, invertH } from '../../src/geo/homography';
import { bbox, centroid, polygonIoU } from './raster';
import type { SceneTruth } from './types';

export interface SegmentationScoreOptions {
  /** IoU needed for a match (default 0.85). */
  iou?: number;
  /** Visible share needed for a piece to count as "should be found" (default 0.99). */
  minVisibleShare?: number;
  /** Count touching pieces as "should be found" too (default false; PLAN §7 scores non-touching pieces). */
  includeTouching?: boolean;
}

export interface SegmentationScore {
  eligible: number;
  found: number;
  /** Detections considered for precision (not ignored). */
  considered: number;
  matched: number;
  recall: number;
  precision: number;
  /** Eligible piece ids that were not found. */
  missed: string[];
  /** Indexes into `found` of detections that matched nothing (false positives). */
  falsePositives: number[];
  /** Per matched piece. */
  matches: Array<{ id: string; foundIndex: number; iou: number; positionErrorMm: number }>;
  positionErrorMm: { median: number; p95: number; max: number; values: number[] };
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}

/** Centre error in table mm between a found top-face outline (img px) and the true one. */
export function positionErrorMm(foundOutlineImg: number[], truthOutlineImg: number[], topToImg: number[]): number {
  const inv = invertH(topToImg);
  if (!inv) return NaN;
  const toTable = (poly: number[]) => {
    const out: number[] = [];
    for (let i = 0; i < poly.length; i += 2) out.push(...applyH(inv, [poly[i]!, poly[i + 1]!]));
    return out;
  };
  const a = centroid(toTable(foundOutlineImg));
  const b = centroid(toTable(truthOutlineImg));
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function segmentationScore(found: Array<{ outlineImg: number[] }>, truth: SceneTruth, opts: SegmentationScoreOptions = {}): SegmentationScore {
  const minIou = opts.iou ?? 0.85;
  const minVis = opts.minVisibleShare ?? 0.99;
  const eligible = truth.pieces.map((p) => p.visibleShare >= minVis && !p.faceDown && (opts.includeTouching || p.touching.length === 0));
  const tBoxes = truth.pieces.map((p) => bbox(p.outlineImg));

  // All candidate pairs with some overlap.
  const pairs: Array<{ f: number; t: number; iou: number }> = [];
  const bestAny = new Array<{ t: number; iou: number }>(found.length);
  found.forEach((f, fi) => {
    const b = bbox(f.outlineImg);
    let best = { t: -1, iou: 0 };
    truth.pieces.forEach((p, ti) => {
      const tb = tBoxes[ti]!;
      if (tb.x1 < b.x0 || b.x1 < tb.x0 || tb.y1 < b.y0 || b.y1 < tb.y0) return;
      const iou = polygonIoU(f.outlineImg, p.outlineImg);
      if (iou > best.iou) best = { t: ti, iou };
      if (iou > 0) pairs.push({ f: fi, t: ti, iou });
    });
    bestAny[fi] = best;
  });
  pairs.sort((a, b) => b.iou - a.iou);
  const fUsed = new Set<number>();
  const tUsed = new Set<number>();
  const matches: SegmentationScore['matches'] = [];
  for (const pr of pairs) {
    if (pr.iou < minIou) break;
    if (fUsed.has(pr.f) || tUsed.has(pr.t)) continue;
    fUsed.add(pr.f);
    tUsed.add(pr.t);
    const p = truth.pieces[pr.t]!;
    matches.push({ id: p.id, foundIndex: pr.f, iou: pr.iou, positionErrorMm: positionErrorMm(found[pr.f]!.outlineImg, p.outlineImg, truth.topToImg) });
  }
  const matchedEligible = matches.filter((m) => eligible[truth.pieces.findIndex((p) => p.id === m.id)]);
  const nEligible = eligible.filter(Boolean).length;

  // Precision: ignore detections whose best partner is an ineligible piece (IoU ≥ 0.3), unless matched to an eligible one.
  let considered = 0;
  let good = 0;
  const falsePositives: number[] = [];
  found.forEach((_, fi) => {
    const m = matches.find((x) => x.foundIndex === fi);
    const ti = m ? truth.pieces.findIndex((p) => p.id === m.id) : bestAny[fi]!.t;
    if (m) {
      if (eligible[ti]) {
        considered++;
        good++;
      }
      return;
    }
    if (ti >= 0 && bestAny[fi]!.iou >= 0.3 && !eligible[ti]) return;
    considered++;
    falsePositives.push(fi);
  });

  const missed = truth.pieces.filter((p, i) => eligible[i] && !matches.some((m) => m.id === p.id)).map((p) => p.id);
  const values = matchedEligible.map((m) => m.positionErrorMm).sort((a, b) => a - b);
  return {
    eligible: nEligible,
    found: found.length,
    considered,
    matched: matchedEligible.length,
    recall: nEligible ? matchedEligible.length / nEligible : 1,
    precision: considered ? good / considered : 1,
    missed,
    falsePositives,
    matches,
    positionErrorMm: { median: quantile(values, 0.5), p95: quantile(values, 0.95), max: values[values.length - 1] ?? NaN, values },
  };
}
