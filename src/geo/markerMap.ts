/**
 * The marker map (RESEARCH §5 "You don't have to measure anything"): from ONE photo that shows the
 * markers, work out where each marker lies on the table, in millimetres.
 *
 * Unknowns: the photo → table homography (8 numbers) and each marker's position and turn on the
 * table (x, y, angle), with the reference marker (0 if seen) fixed at the origin. Every marker is a
 * square of known printed size, so 8 markers × 4 corners pin all of it down, including the scale.
 * Solved by Levenberg–Marquardt on the corner errors in mm.
 */
import type { Mat3, MarkerMap, Vec2 } from '../project/types';
import { applyH, fitHomography, normaliseH, solveLinear } from './homography';
import { markerCornersMm } from '../markers/layout';

export interface MarkerSighting {
  id: number;
  /** 4 corners in photo px (OpenCV order). */
  corners: Vec2[];
}

export interface MarkerMapSolution {
  map: Omit<MarkerMap, 'createdAt' | 'snapId' | 'printScale'>;
  imgToTable: Mat3;
  /** Corner error per marker (mm, RMS). */
  perMarkerMm: Record<number, number>;
}

export class MarkerMapError extends Error {}

export function solveMarkerMap(sightings: MarkerSighting[], markerSizeMm: number, opts: { minMarkers?: number } = {}): MarkerMapSolution {
  const minMarkers = opts.minMarkers ?? 4;
  const seen = new Map<number, MarkerSighting>();
  for (const s of sightings) if (s.corners.length === 4 && !seen.has(s.id)) seen.set(s.id, s);
  if (seen.size < minMarkers) throw new MarkerMapError(`Only ${seen.size} of the markers are in the photo; at least ${minMarkers} are needed`);
  const ids = [...seen.keys()].sort((a, b) => a - b);
  const ref = ids[0]!;
  const others = ids.slice(1);

  // Work in normalised image coordinates so all unknowns have similar sizes.
  const all = ids.flatMap((id) => seen.get(id)!.corners);
  const mx = all.reduce((a, p) => a + p[0], 0) / all.length;
  const my = all.reduce((a, p) => a + p[1], 0) / all.length;
  const sc = all.reduce((a, p) => a + Math.hypot(p[0] - mx, p[1] - my), 0) / all.length || 1;
  const norm = (p: Vec2): Vec2 => [(p[0] - mx) / sc, (p[1] - my) / sc];
  const N: Mat3 = [1 / sc, 0, -mx / sc, 0, 1 / sc, -my / sc, 0, 0, 1];
  const pts = new Map(ids.map((id) => [id, seen.get(id)!.corners.map(norm)]));

  // Initial guess: homography from the reference marker alone, then each marker's pose from it.
  const H0 = fitHomography(pts.get(ref)!, markerCornersMm(0, 0, 0, markerSizeMm));
  if (!H0) throw new MarkerMapError('The markers could not be measured (degenerate photo)');
  const params: number[] = H0.slice(0, 8);
  for (const id of others) {
    const c = pts.get(id)!.map((p) => applyH(H0, p));
    const cx = (c[0]![0] + c[1]![0] + c[2]![0] + c[3]![0]) / 4;
    const cy = (c[0]![1] + c[1]![1] + c[2]![1] + c[3]![1]) / 4;
    // Angle from the two "horizontal" edges (top and bottom), averaged.
    const a1 = Math.atan2(c[1]![1] - c[0]![1], c[1]![0] - c[0]![0]);
    const a2 = Math.atan2(c[2]![1] - c[3]![1], c[2]![0] - c[3]![0]);
    params.push(cx, cy, Math.atan2(Math.sin(a1) + Math.sin(a2), Math.cos(a1) + Math.cos(a2)));
  }

  const residuals = (p: number[]): number[] => {
    const H = [...p.slice(0, 8), 1];
    const out: number[] = [];
    ids.forEach((id, k) => {
      const model = k === 0 ? markerCornersMm(0, 0, 0, markerSizeMm) : markerCornersMm(p[8 + 3 * (k - 1)]!, p[9 + 3 * (k - 1)]!, (p[10 + 3 * (k - 1)]! * 180) / Math.PI, markerSizeMm);
      pts.get(id)!.forEach((q, j) => {
        const t = applyH(H, q);
        out.push(t[0] - model[j]![0], t[1] - model[j]![1]);
      });
    });
    return out;
  };

  const p = levenbergMarquardt(residuals, params, 100);
  const H = normaliseH([...p.slice(0, 8), 1]);
  const imgToTable = normaliseH(mulH3(H, N));
  const r = residuals(p);
  const perMarkerMm: Record<number, number> = {};
  ids.forEach((id, k) => {
    let s = 0;
    for (let j = 0; j < 8; j++) s += r[k * 8 + j]! ** 2;
    perMarkerMm[id] = Math.sqrt(s / 4);
  });
  const rmsMm = Math.sqrt(r.reduce((a, v) => a + v * v, 0) / (r.length / 2));
  const markers = ids.map((id, k) => ({
    id,
    cornersMm: k === 0 ? markerCornersMm(0, 0, 0, markerSizeMm) : markerCornersMm(p[8 + 3 * (k - 1)]!, p[9 + 3 * (k - 1)]!, (p[10 + 3 * (k - 1)]! * 180) / Math.PI, markerSizeMm),
  }));
  return { map: { dictionary: 'DICT_4X4_50', markerSizeMm, markers, rmsMm }, imgToTable, perMarkerMm };
}

function mulH3(A: Mat3, B: Mat3): Mat3 {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3]! * B[c]! + A[r * 3 + 1]! * B[3 + c]! + A[r * 3 + 2]! * B[6 + c]!;
  return o;
}

/** Minimises Σ r(p)² by Levenberg–Marquardt with a numerical Jacobian (small problems only). */
export function levenbergMarquardt(f: (p: number[]) => number[], p0: number[], maxIter: number): number[] {
  let p = p0.slice();
  let r = f(p);
  let cost = r.reduce((a, v) => a + v * v, 0);
  let lambda = 1e-3;
  const n = p.length;
  for (let it = 0; it < maxIter; it++) {
    const J: number[][] = [];
    for (let i = 0; i < n; i++) {
      const h = 1e-7 * Math.max(1, Math.abs(p[i]!));
      const q = p.slice();
      q[i]! += h;
      const rq = f(q);
      J.push(rq.map((v, k) => (v - r[k]!) / h));
    }
    const JtJ = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => J[i]!.reduce((a, v, k) => a + v * J[j]![k]!, 0)));
    const Jtr = J.map((col) => col.reduce((a, v, k) => a + v * r[k]!, 0));
    let improved = false;
    for (let tries = 0; tries < 10; tries++) {
      const M = JtJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const step = solveLinear(M, Jtr.map((v) => -v));
      if (!step) {
        lambda *= 10;
        continue;
      }
      const q = p.map((v, i) => v + step[i]!);
      const rq = f(q);
      const cq = rq.reduce((a, v) => a + v * v, 0);
      if (cq < cost) {
        const rel = (cost - cq) / Math.max(cost, 1e-30);
        p = q;
        r = rq;
        cost = cq;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (rel < 1e-12) return p;
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  return p;
}
