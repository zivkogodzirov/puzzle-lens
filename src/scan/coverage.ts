/**
 * The coverage map (PLAN §1 step 2, §6 M2): which parts of the sorting area already have a
 * close-up sharp enough for reading shapes, and where the next close-up should go.
 *
 * The sorting area is the rectangle inside the marker ring. It is split into 10 mm cells; a cell
 * counts as covered by a photo when the photo sees it at ≥ `minPxPerMm` and at least `marginMm`
 * inside the photo's edges (so a piece centred there is fully in the picture).
 */
import { applyH, invertH } from '../geo/homography';
import type { Mat3, MarkerMap, Vec2 } from '../project/types';
import { markerCentres } from './autoCapture';
import { MARKER_CARD_MM } from '../markers/layout';

export const CELL_MM = 10;

export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The sorting area: the bounding box of the marker centres, minus half a marker card on each side. */
export function sortingArea(map: MarkerMap): Area {
  const c = markerCentres(map);
  const inset = MARKER_CARD_MM / 2;
  const xs = c.map((p) => p[0]);
  const ys = c.map((p) => p[1]);
  return { x0: Math.min(...xs) + inset, y0: Math.min(...ys) + inset, x1: Math.max(...xs) - inset, y1: Math.max(...ys) - inset };
}

export class Coverage {
  readonly cols: number;
  readonly rows: number;
  /** Best px/mm seen per cell (0 = never covered well enough). */
  readonly best: Float32Array;
  /** Table points under the centres of the close-ups taken so far. */
  readonly photoCentres: Vec2[] = [];

  constructor(
    readonly area: Area,
    readonly minPxPerMm = 8.5,
    readonly marginMm = 25,
  ) {
    this.cols = Math.max(1, Math.ceil((area.x1 - area.x0) / CELL_MM));
    this.rows = Math.max(1, Math.ceil((area.y1 - area.y0) / CELL_MM));
    this.best = new Float32Array(this.cols * this.rows);
  }

  cellCentre(i: number): Vec2 {
    const c = i % this.cols;
    const r = Math.floor(i / this.cols);
    return [this.area.x0 + (c + 0.5) * CELL_MM, this.area.y0 + (r + 0.5) * CELL_MM];
  }

  /** Records a photo. Returns how many cells became newly covered. */
  addPhoto(tableToImg: Mat3, frame: { width: number; height: number }, pxPerMm: number): number {
    if (pxPerMm < this.minPxPerMm) return 0;
    const inv = invertH(tableToImg);
    if (inv) this.photoCentres.push(applyH(inv, [(frame.width - 1) / 2, (frame.height - 1) / 2]));
    const m = this.marginMm * pxPerMm;
    let added = 0;
    for (let i = 0; i < this.best.length; i++) {
      const p = applyH(tableToImg, this.cellCentre(i));
      if (p[0] < m || p[1] < m || p[0] > frame.width - m || p[1] > frame.height - m) continue;
      if (this.best[i]! < this.minPxPerMm) added++;
      this.best[i] = Math.max(this.best[i]!, pxPerMm);
    }
    return added;
  }

  isCovered(i: number): boolean {
    return this.best[i]! >= this.minPxPerMm;
  }

  /** Share of cells covered (0–1). */
  share(): number {
    let n = 0;
    for (let i = 0; i < this.best.length; i++) if (this.isCovered(i)) n++;
    return n / this.best.length;
  }

  /**
   * The close-up plan: an even grid of photo centres, in reading order (far-left first).
   *
   * `fullViewMm` is the whole picture's size on the table. Every close-up must (1) cover its share
   * of the area with its useful part (the picture minus `marginMm` on each side), and (2) when
   * `markers` (marker centres) are given, the outer close-ups reach out far enough to show the
   * ring's markers whole, because the live gauge and the photo's table position need a marker in
   * view. The grid grows until both hold. With a 70 × 50 cm area at 2× this is 2 × 2 from ~65 cm
   * and 3 × 2 from ~60 cm.
   */
  plan(fullViewMm: Vec2, markers?: Vec2[], markerHalfMm = 27): Vec2[] {
    const pad = markerHalfMm + 25; // marker half-size plus room for a few degrees of tilt and a shaky aim
    const ex0 = markers ? Math.min(this.area.x0, ...markers.map((m) => m[0] - pad)) : this.area.x0 - this.marginMm;
    const ex1 = markers ? Math.max(this.area.x1, ...markers.map((m) => m[0] + pad)) : this.area.x1 + this.marginMm;
    const ey0 = markers ? Math.min(this.area.y0, ...markers.map((m) => m[1] - pad)) : this.area.y0 - this.marginMm;
    const ey1 = markers ? Math.max(this.area.y1, ...markers.map((m) => m[1] + pad)) : this.area.y1 + this.marginMm;
    const axis = (e0: number, e1: number, a0: number, a1: number, full: number): number[] => {
      const useful = full - 2 * this.marginMm;
      if (useful <= 0) return [(a0 + a1) / 2];
      for (let n = 1; n < 50; n++) {
        // Outer pictures flush with the outer extent (or centred when one picture is enough).
        const first = n === 1 ? (e0 + e1) / 2 : Math.min(e0 + full / 2, (e0 + e1) / 2);
        const last = n === 1 ? first : Math.max(e1 - full / 2, (e0 + e1) / 2);
        const cs = Array.from({ length: n }, (_, i) => (n === 1 ? first : first + (i * (last - first)) / (n - 1)));
        const step = n > 1 ? (last - first) / (n - 1) : 0;
        const reachesEnds = cs[0]! - full / 2 <= e0 + 1e-6 && cs[n - 1]! + full / 2 >= e1 - 1e-6;
        const coversArea = cs[0]! - useful / 2 <= a0 + 1e-6 && cs[n - 1]! + useful / 2 >= a1 - 1e-6 && step <= useful + 1e-6;
        if (reachesEnds && coversArea) return cs;
      }
      return [(a0 + a1) / 2];
    };
    const xs = axis(ex0, ex1, this.area.x0, this.area.x1, fullViewMm[0]);
    const ys = axis(ey0, ey1, this.area.y0, this.area.y1, fullViewMm[1]);
    return ys.flatMap((y) => xs.map((x): Vec2 => [x, y]));
  }

  /**
   * Where the next close-up should be centred: the first photo of the plan that hasn't been taken
   * yet (no close-up centred within `visitedMm` of it) and whose useful view still has uncovered
   * cells. Once every planned photo is taken, any left-over gap. Null when (almost) all is covered.
   */
  nextTarget(fullViewMm: Vec2, markers?: Vec2[], doneShare = 0.98, visitedMm = 80): Vec2 | null {
    if (this.share() >= doneShare) return null;
    const hw = fullViewMm[0] / 2 - this.marginMm;
    const hh = fullViewMm[1] / 2 - this.marginMm;
    let fallback: Vec2 | null = null;
    for (const c of this.plan(fullViewMm, markers)) {
      let inView = 0;
      let open = 0;
      for (let i = 0; i < this.best.length; i++) {
        const p = this.cellCentre(i);
        if (Math.abs(p[0] - c[0]) > hw || Math.abs(p[1] - c[1]) > hh) continue;
        inView++;
        if (!this.isCovered(i)) open++;
      }
      const visited = this.photoCentres.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= visitedMm);
      if (!visited && open > 0.03 * inView) return c;
      if (open > 0 && !fallback && !visited) fallback = c;
    }
    if (fallback) return fallback;
    // Every planned photo is done but small gaps remain (shaky aim): centre on the largest gap.
    let gap: Vec2 | null = null;
    let most = 0;
    for (let i = 0; i < this.best.length; i++) {
      if (this.isCovered(i)) continue;
      const c = this.cellCentre(i);
      let n = 0;
      for (let k = 0; k < this.best.length; k++) {
        const p = this.cellCentre(k);
        if (!this.isCovered(k) && Math.abs(p[0] - c[0]) <= hw && Math.abs(p[1] - c[1]) <= hh) n++;
      }
      if (n > most) {
        most = n;
        gap = c;
      }
    }
    return gap;
  }
}
