/**
 * Photo (Snap) analysis helpers, run in the reader worker and in Node tests.
 * Big photos are processed tile by tile so a 12 MP image is never copied whole into OpenCV
 * (RESEARCH §3: canvas and memory limits).
 */
import { cvGuard, type Cv } from './loadCv';
import { withScope } from './scope';
import type { PixelBuffer } from './frameAnalyser';
import { copyRows } from './frameAnalyser';
import type { TwoXResult } from '../shared/types';

export interface TileStats {
  pixels: number;
  sumLuma: number;
  clippedHigh: number;
  clippedLow: number;
  lapVar: number;
}

/** Statistics of one RGBA tile: brightness, blown-out / crushed share, sharpness. */
export function tileStats(cv: Cv, tile: PixelBuffer, order: 'RGBA' | 'BGRA' = 'RGBA'): TileStats {
  return cvGuard(cv, () => withScope((s) => {
    const rgba = s.keep(new cv.Mat(tile.height, tile.width, cv.CV_8UC4));
    copyRows(rgba, tile, 4);
    const gray = s.keep(new cv.Mat());
    cv.cvtColor(rgba, gray, order === 'RGBA' ? cv.COLOR_RGBA2GRAY : cv.COLOR_BGRA2GRAY);
    const pixels = tile.width * tile.height;
    const mean = cv.mean(gray) as number[];
    const tmp = s.keep(new cv.Mat());
    cv.threshold(gray, tmp, 249, 255, cv.THRESH_BINARY);
    const high = cv.countNonZero(tmp) as number;
    cv.threshold(gray, tmp, 5, 255, cv.THRESH_BINARY_INV);
    const low = cv.countNonZero(tmp) as number;
    const lap = s.keep(new cv.Mat());
    cv.Laplacian(gray, lap, cv.CV_16S, 3);
    const m = s.keep(new cv.Mat());
    const sd = s.keep(new cv.Mat());
    cv.meanStdDev(lap, m, sd);
    const sdv = sd.data64F[0] ?? 0;
    return { pixels, sumLuma: (mean[0] ?? 0) * pixels, clippedHigh: high, clippedLow: low, lapVar: sdv * sdv };
  }));
}

/**
 * Fine detail of a grey image: the RMS of a band-pass (difference of Gaussian blurs, σ 0.7 and
 * 1.4 px). That band sits just below the finest detail a sensor can record, which is exactly what
 * a 1× crop enlarged 2× lacks and a true 2× crop has. The σ 0.7 blur keeps per-pixel sensor noise
 * out. (The first version used mean gradient after a σ 1 blur, which threw that band away: a true
 * 2× scored ≈ 1.05, the same as digital zoom.) Measured on synthetic pairs (test/unit/
 * core-photo-analysis): true 2× 1.03–1.36, digital zoom 0.71–1.00, unchanged by ±8 noise;
 * scenes without fine detail come out ≈ 1 either way (the test needs a detailed print).
 */
export function detailEnergy(cv: Cv, gray: PixelBuffer): number {
  return cvGuard(cv, () =>
    withScope((s) => {
      const src = s.keep(new cv.Mat(gray.height, gray.width, cv.CV_8UC1));
      copyRows(src, gray, 1);
      return detailEnergyMat(cv, src, s);
    }),
  );
}

const EDGE = 4;

function detailEnergyMat(cv: Cv, src: { cols: number; rows: number }, s: { keep<T extends { delete(): void }>(o: T): T }): number {
  const f = s.keep(new cv.Mat());
  (src as unknown as { convertTo(dst: unknown, type: number): void }).convertTo(f, cv.CV_32F);
  const a = s.keep(new cv.Mat());
  const b = s.keep(new cv.Mat());
  cv.GaussianBlur(f, a, new cv.Size(0, 0), 0.7, 0.7);
  cv.GaussianBlur(f, b, new cv.Size(0, 0), 1.4, 1.4);
  const band = s.keep(new cv.Mat());
  cv.subtract(a, b, band);
  // Ignore a thin border where the blurs see the image edge.
  const inner = src.cols > 4 * EDGE && src.rows > 4 * EDGE ? s.keep(band.roi(new cv.Rect(EDGE, EDGE, src.cols - 2 * EDGE, src.rows - 2 * EDGE))) : band;
  const mean = s.keep(new cv.Mat());
  const sd = s.keep(new cv.Mat());
  cv.meanStdDev(inner, mean, sd);
  return sd.data64F[0] ?? 0;
}

/**
 * Centre windows to compare for the 2× test: an a×b window from the middle of the 1× photo and
 * the 2a×2b window from the middle of the 2× photo show the same patch of table.
 */
export function twoXWindows(oneW: number, oneH: number, twoW: number, twoH: number) {
  const a = Math.min(512, Math.floor(oneW / 4));
  const b = Math.min(384, Math.floor(oneH / 4));
  const w2 = Math.min(2 * a, twoW);
  const h2 = Math.min(2 * b, twoH);
  return {
    one: { x: Math.floor((oneW - a) / 2), y: Math.floor((oneH - b) / 2), width: a, height: b },
    two: { x: Math.floor((twoW - w2) / 2), y: Math.floor((twoH - h2) / 2), width: w2, height: h2 },
  };
}

/**
 * Is the 2× camera a real sensor crop (more detail) or digital zoom (just enlarged)?
 * Both photos are taken from the same spot. The 2× photo shows the middle half of the 1× view,
 * so we enlarge the middle of the 1× photo 2× and compare detail with the middle of the 2× photo
 * (RESEARCH §4 "The 2× lens", PLAN §6 M1). Inputs are the 4-channel centre windows from
 * `twoXWindows`, so full 12 MP photos never need to be copied.
 */
export function twoXRatio(
  cv: Cv,
  oneCrop: PixelBuffer,
  twoCrop: PixelBuffer,
  sizes: { one: [number, number]; two: [number, number] },
  order: 'RGBA' | 'BGRA' = 'RGBA',
): TwoXResult {
  return cvGuard(cv, () => withScope((s) => {
    const code = order === 'RGBA' ? cv.COLOR_RGBA2GRAY : cv.COLOR_BGRA2GRAY;
    const one4 = s.keep(new cv.Mat(oneCrop.height, oneCrop.width, cv.CV_8UC4));
    copyRows(one4, oneCrop, 4);
    const one = s.keep(new cv.Mat());
    cv.cvtColor(one4, one, code);
    const up = s.keep(new cv.Mat());
    cv.resize(one, up, new cv.Size(2 * oneCrop.width, 2 * oneCrop.height), 0, 0, cv.INTER_CUBIC);

    const two4 = s.keep(new cv.Mat(twoCrop.height, twoCrop.width, cv.CV_8UC4));
    copyRows(two4, twoCrop, 4);
    const two = s.keep(new cv.Mat());
    cv.cvtColor(two4, two, code);

    const e1 = detailEnergyMat(cv, up, s);
    const e2 = detailEnergyMat(cv, two, s);
    return twoXVerdict(e1, e2, sizes);
  }));
}

/** Below this much fine detail in either photo, there is nothing to compare. */
export const TWO_X_MIN_DETAIL = 0.25;
/** Provisional thresholds from synthetic pairs; to be set from real iPhone measurements (PLAN §7). */
export const TWO_X_TRUE_AT = 1.1;
export const TWO_X_DIGITAL_AT = 1.02;

/**
 * Thresholds for the 2× verdict, separated so they can be unit-tested. The verdict is a
 * PROVISIONAL hint for the developer: the Device check shows only the measured ratio until the
 * thresholds have been checked against the owner's iPhone (ISP sharpening can lift digital zoom).
 */
export function twoXVerdict(e1: number, e2: number, sizes: { one: [number, number]; two: [number, number] }): TwoXResult {
  const ratio = e1 > TWO_X_MIN_DETAIL ? e2 / e1 : 0;
  let verdict: TwoXResult['verdict'] = 'unclear';
  if (e1 > TWO_X_MIN_DETAIL && e2 > TWO_X_MIN_DETAIL) {
    if (ratio >= TWO_X_TRUE_AT) verdict = 'true-2x';
    else if (ratio <= TWO_X_DIGITAL_AT) verdict = 'digital-zoom';
  }
  return { ratio, verdict, oneXSize: sizes.one, twoXSize: sizes.two };
}
