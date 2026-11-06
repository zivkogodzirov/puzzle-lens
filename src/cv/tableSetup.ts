/**
 * Wizard step 5 (PLAN §5): one photo of the empty sorting area with all 8 markers around it gives
 * the marker map (where each marker lies, in mm) and — once piece finding is in — the table model.
 * Runs in the reader worker; pure function of the decoded photo so it is tested in Node.
 */
import type { Cv } from './loadCv';
import type { PixelBuffer } from './frameAnalyser';
import { withScope } from './scope';
import { PhotoChecker } from './photoCheck';
import { MarkerMapError, solveMarkerMap } from '../geo/markerMap';
import { MARKER_COUNT, MARKER_SIZE_MM } from '../markers/layout';
import type { Mat3, MarkerMap, PhotoQuality, Vec2 } from '../project/types';

export interface TableSetupResult {
  ok: boolean;
  /** Plain-English problems (empty when ok). */
  problems: string[];
  map: MarkerMap | null;
  imgToTable: Mat3 | null;
  /** Ids of the markers that were not found. */
  missing: number[];
  /** Corner error per marker (mm). */
  perMarkerMm: Record<number, number>;
  quality: PhotoQuality;
}

/** A marker whose corners disagree with a square of the printed size by more than this is suspect. */
export const MAX_MARKER_ERROR_MM = 1.5;

/** Grey copy of an RGBA/BGRA buffer (OpenCV), as a plain buffer. */
export function toGray(cv: Cv, img: PixelBuffer, order: 'RGBA' | 'BGRA' = 'RGBA'): PixelBuffer {
  return withScope((s) => {
    const src = s.keep(new cv.Mat(img.height, img.width, cv.CV_8UC4));
    const rowBytes = img.width * 4;
    const dst = src.data as Uint8Array;
    if (img.stride === rowBytes) dst.set(img.data.subarray(0, rowBytes * img.height));
    else for (let y = 0; y < img.height; y++) dst.set(img.data.subarray(y * img.stride, y * img.stride + rowBytes), y * rowBytes);
    const g = s.keep(new cv.Mat());
    cv.cvtColor(src, g, order === 'RGBA' ? cv.COLOR_RGBA2GRAY : cv.COLOR_BGRA2GRAY);
    return { data: Uint8Array.from(g.data as Uint8Array), width: img.width, height: img.height, stride: img.width };
  });
}

export function setupFromPhoto(
  cv: Cv,
  checker: PhotoChecker,
  gray: PixelBuffer,
  opts: { printScale: number; snapId: string; zoom?: number; now?: number },
): TableSetupResult {
  const check = checker.check(gray, { map: null, zoom: opts.zoom ?? 1, kind: 'overview' });
  const problems = check.quality.reasons.filter((r) => !/^No markers/.test(r));
  const seen = new Set(check.markers.map((m) => m.id));
  const missing = Array.from({ length: MARKER_COUNT }, (_, i) => i).filter((i) => !seen.has(i));
  const result = (extra: Partial<TableSetupResult>): TableSetupResult => ({
    ok: false,
    problems,
    map: null,
    imgToTable: null,
    missing,
    perMarkerMm: {},
    quality: check.quality,
    ...extra,
  });
  if (missing.length) {
    problems.unshift(
      missing.length === MARKER_COUNT
        ? 'No markers found. Lay the 8 marker cards around the sorting area, then photograph all of them.'
        : `${MARKER_COUNT - missing.length} of ${MARKER_COUNT} markers found (missing: ${missing.map((m) => `#${m}`).join(', ')}). Raise the phone until all 8 are in the picture.`,
    );
    return result({});
  }
  const sightings = check.markers
    .filter((m) => m.id < MARKER_COUNT)
    .map((m) => ({ id: m.id, corners: [0, 1, 2, 3].map((k): Vec2 => [m.corners[2 * k]!, m.corners[2 * k + 1]!]) }));
  try {
    const sizeMm = MARKER_SIZE_MM * opts.printScale;
    const sol = solveMarkerMap(sightings, sizeMm, { minMarkers: MARKER_COUNT });
    const bad = Object.entries(sol.perMarkerMm)
      .filter(([, e]) => e > MAX_MARKER_ERROR_MM)
      .map(([id]) => Number(id));
    if (bad.length) problems.push(`Marker${bad.length > 1 ? 's' : ''} ${bad.map((b) => `#${b}`).join(', ')} could not be measured cleanly: make sure each card lies flat.`);
    const map: MarkerMap = { ...sol.map, printScale: opts.printScale, createdAt: opts.now ?? Date.now(), snapId: opts.snapId };
    return result({ ok: problems.length === 0, map, imgToTable: sol.imgToTable, perMarkerMm: sol.perMarkerMm });
  } catch (err) {
    problems.unshift(err instanceof MarkerMapError ? err.message : `The markers could not be measured: ${String(err)}`);
    return result({});
  }
}
