/**
 * The photo quality gate (PLAN §3.3) for Snaps taken while scanning: finds the markers in the
 * full-size photo, places the photo on the table, and checks it is usable — sharp (no hand
 * shake), level, not blown out. Runs in the reader worker on the decoded photo's grey image.
 */
import type { Cv } from './loadCv';
import { FrameAnalyser, type PixelBuffer } from './frameAnalyser';
import { locateOnTable, type TableFix } from '../geo/tableFix';
import type { MarkerMap, PhotoQuality } from '../project/types';
import type { MarkerDetection } from '../shared/types';
import type { CaptureKind } from '../scan/autoCapture';

/** Markers are found on a 2016 px wide copy (half of 12 MP): ~2× more accurate corners than live. */
export const PHOTO_MARKER_WIDTH = 2016;

/** Above this 10–90 % edge width (px, full size) the photo is too blurred (sharp ≈ 1.5–2.5). */
export const MAX_EDGE_WIDTH_PX = 4.5;
/** Share of blown-out pixels (≥ 250) above which glare/overexposure is reported. */
export const MAX_CLIPPED_SHARE = 0.03;
export const MAX_TILT_DEG: Record<CaptureKind, number> = { overview: 8, detail: 5 };

export interface PhotoCheck {
  markers: MarkerDetection[];
  fix: TableFix | null;
  /** Median 10–90 % edge width across marker borders (px), null without markers. */
  edgeWidthPx: number | null;
  quality: PhotoQuality;
}

export class PhotoChecker {
  private readonly analyser: FrameAnalyser;

  constructor(private readonly cv: Cv) {
    this.analyser = new FrameAnalyser(cv, { analysisWidth: PHOTO_MARKER_WIDTH });
  }

  check(gray: PixelBuffer, opts: { map: MarkerMap | null; zoom: number; kind: CaptureKind }): PhotoCheck {
    void this.cv;
    const a = this.analyser.analyseGray(gray);
    const fix = opts.map ? locateOnTable(a.markers, opts.map, { width: gray.width, height: gray.height }, opts.zoom) : null;
    const edgeWidthPx = markerEdgeWidth(gray, a.markers);
    const clippedShare = clipped(gray);
    const reasons: string[] = [];
    if (!a.markers.length) reasons.push('No markers in the photo: include at least one marker');
    else if (opts.map && !fix) reasons.push('The markers in the photo are not the ones laid out for this puzzle');
    if (edgeWidthPx !== null && edgeWidthPx > MAX_EDGE_WIDTH_PX) reasons.push('Blurred: hold the phone still');
    if (fix && fix.tiltDeg > MAX_TILT_DEG[opts.kind]) reasons.push('Tilted: hold the phone flat');
    if (clippedShare > MAX_CLIPPED_SHARE) reasons.push('Too bright in places (glare): tilt the phone slightly or move the light to the side');
    return {
      markers: a.markers,
      fix,
      edgeWidthPx,
      quality: {
        ok: reasons.length === 0,
        reasons,
        sharpness: a.sharpness,
        clippedShare,
        glareShare: 0,
        tiltDeg: fix?.tiltDeg ?? null,
        heightMm: fix?.heightMm ?? null,
        markersSeen: a.markers.length,
      },
    };
  }

  dispose(): void {
    this.analyser.dispose();
  }
}

/** Share of pixels at or above 250, sampled every 4th pixel in both directions. */
export function clipped(img: PixelBuffer): number {
  let n = 0;
  let hi = 0;
  for (let y = 0; y < img.height; y += 4) {
    const row = y * img.stride;
    for (let x = 0; x < img.width; x += 4) {
      n++;
      if (img.data[row + x]! >= 250) hi++;
    }
  }
  return n ? hi / n : 0;
}

function sample(img: PixelBuffer, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(img.width - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(img.height - 2, Math.floor(y)));
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const i = y0 * img.stride + x0;
  const a = img.data[i]!;
  const b = img.data[i + 1]!;
  const c = img.data[i + img.stride]!;
  const d = img.data[i + img.stride + 1]!;
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/**
 * How blurred the photo is, measured where we know there is a perfect step: the outer border of
 * each marker (black square inside a white quiet zone). For 6 points along each side, a profile
 * across the edge is sampled and the distance over which it rises from 10 % to 90 % is measured.
 * Hand shake widens it in one direction, defocus in all; the median over all profiles is returned.
 */
export function markerEdgeWidth(img: PixelBuffer, markers: MarkerDetection[]): number | null {
  const widths: number[] = [];
  const HALF = 14;
  const STEP = 0.25;
  for (const m of markers) {
    const c = m.corners;
    const cx = (c[0]! + c[2]! + c[4]! + c[6]!) / 4;
    const cy = (c[1]! + c[3]! + c[5]! + c[7]!) / 4;
    for (let s = 0; s < 4; s++) {
      const ax = c[2 * s]!;
      const ay = c[2 * s + 1]!;
      const bx = c[(2 * s + 2) % 8]!;
      const by = c[(2 * s + 3) % 8]!;
      const len = Math.hypot(bx - ax, by - ay);
      // Too small to measure an edge profile reliably.
      if (len < 40) continue;
      // Outward normal.
      let nx = (by - ay) / len;
      let ny = -(bx - ax) / len;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      if ((mx - cx) * nx + (my - cy) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      for (let k = 1; k <= 6; k++) {
        // Stay clear of the corners (and of the marker's inner bits near them).
        const t = 0.2 + (0.6 * (k - 0.5)) / 6;
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        const prof: number[] = [];
        for (let d = -HALF; d <= HALF; d += STEP) {
          const x = px + nx * d;
          const y = py + ny * d;
          if (x < 1 || y < 1 || x > img.width - 2 || y > img.height - 2) {
            prof.length = 0;
            break;
          }
          prof.push(sample(img, x, y));
        }
        if (!prof.length) continue;
        // Inside (black) at the start, outside (white) at the end: use the plateaus.
        const n = prof.length;
        const q = Math.max(1, Math.floor(n / 6));
        const lo = prof.slice(0, q).reduce((a, v) => a + v, 0) / q;
        const hi = prof.slice(n - q).reduce((a, v) => a + v, 0) / q;
        if (hi - lo < 40) continue; // not a clean edge (glare, shadow)
        const v10 = lo + 0.1 * (hi - lo);
        const v90 = lo + 0.9 * (hi - lo);
        // Search outward from the steepest point, so texture elsewhere can't confuse it.
        let steep = 1;
        for (let i = 1; i < n; i++) if (prof[i]! - prof[i - 1]! > prof[steep]! - prof[steep - 1]!) steep = i;
        let i10 = steep;
        while (i10 > 0 && prof[i10]! > v10) i10--;
        let i90 = steep;
        while (i90 < n - 1 && prof[i90]! < v90) i90++;
        const f = (i: number, v: number) => {
          const a = prof[i]!;
          const b = prof[i + 1] ?? a;
          return b !== a ? i + (v - a) / (b - a) : i;
        };
        const w = (f(i90 - 1, v90) - f(i10, v10)) * STEP;
        if (w > 0 && w < 2 * HALF) widths.push(w);
      }
    }
  }
  if (widths.length < 4) return null;
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length / 2)]!;
}
