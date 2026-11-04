/**
 * FrameAnalyser (src/cv/frameAnalyser.ts): the tracker's per-frame work — shrink to 960 px,
 * find ArUco DICT_4X4_50 markers, measure sharpness — on synthetic camera frames.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyRows, ensureMat, FrameAnalyser, type FrameAnalysis } from '../../src/cv/frameAnalyser';
import { cvCounters } from '../../src/cv/scope';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { getCv, type Cv } from '../helpers/cv';
import {
  gaussianBlur,
  grayToRgba,
  markerFrame,
  maxCornerError,
  swapRedBlue,
  texture,
  withStride,
  type ExpectedMarker,
} from '../helpers/images';

const W = 1920;
const H = 1080;
const ID = 7;
/**
 * Allowed corner error in full-frame pixels. The analysis image is half size; with sub-pixel
 * corner refinement and pixel-centre scaling (frameAnalyser.ts upscaleCoord) corners land within
 * ≈ 0.25 px (they were up to 2.5 px off before).
 */
const TOL_PX = 0.5;

let cv: Cv;
let analyser: FrameAnalyser;
let persistentBefore = 0;
let frame: PixelBuffer;
let expected: ExpectedMarker;

beforeAll(async () => {
  cv = await getCv();
  persistentBefore = cvCounters.livePersistent;
  analyser = new FrameAnalyser(cv); // default analysisWidth 960
  // 216 px marker = 6 cells of 36 px (4×4 bits + black border); 108 px in the 960-wide analysis image.
  const made = markerFrame(cv, W, H, [{ id: ID, x: 702, y: 386, side: 216 }], { seed: 11 });
  frame = made.image;
  expected = made.expected[0]!;
});

afterAll(() => {
  analyser.dispose();
});

function expectMarker(a: FrameAnalysis, exp: ExpectedMarker, tol = TOL_PX): number {
  const hits = a.markers.filter((m) => m.id === exp.id);
  expect(hits.length, `marker ${exp.id} found once (got ids ${a.markers.map((m) => m.id).join(',') || 'none'})`).toBe(1);
  const err = maxCornerError(hits[0]!.corners, exp.corners);
  expect(err, `corner error ${err.toFixed(2)} px`).toBeLessThanOrEqual(tol);
  return err;
}

describe('FrameAnalyser.analyseGray', () => {
  it('finds marker 7 with corners in FULL-frame coordinates (frame shrunk 1920 → 960)', () => {
    const a = analyser.analyseGray(frame);
    expect(a.analysisWidth).toBe(960);
    expect(a.markers.map((m) => m.id)).toEqual([ID]);
    const err = expectMarker(a, expected);
    // Corners must be in full-frame pixels, not analysis pixels (those would be ~half).
    const c = a.markers[0]!.corners;
    expect(c[0]).toBeGreaterThan(650);
    expect(c[4]).toBeGreaterThan(900);
    console.info(`[frame-analyser] 1920×1080 corner error ${err.toFixed(2)} px; corners ${c.map((v) => v.toFixed(1)).join(', ')}`);
    expect(a.sharpness).toBeGreaterThan(0);
    for (const k of ['copy', 'resize', 'markers', 'sharpness']) expect(a.timings[k], `timing ${k}`).toBeGreaterThanOrEqual(0);
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('works with a padded row stride (stride > width), giving identical results', () => {
    const padded = withStride(frame, 1, W + 64);
    const a = analyser.analyseGray(padded);
    const b = analyser.analyseGray(frame);
    expectMarker(a, expected);
    expect(a.markers).toEqual(b.markers);
    expect(a.sharpness).toBe(b.sharpness);
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('frames narrower than the analysis width are not resized and corners stay exact', () => {
    const small = markerFrame(cv, 640, 480, [{ id: 3, x: 200, y: 150, side: 120 }], { seed: 5 });
    const a = analyser.analyseGray(small.image);
    expect(a.analysisWidth).toBe(640);
    expectMarker(a, small.expected[0]!, 0.75); // no shrinking: only the ±0.5 px pixel-centre offset
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('finds several markers at once, each with the right id', () => {
    const multi = markerFrame(
      cv,
      W,
      H,
      [
        { id: 0, x: 120, y: 120, side: 168 },
        { id: 7, x: 1500, y: 140, side: 168 },
        { id: 23, x: 140, y: 760, side: 168 },
        { id: 49, x: 1560, y: 780, side: 168 },
      ],
      { seed: 21 },
    );
    const a = analyser.analyseGray(multi.image);
    expect(a.markers.map((m) => m.id).sort((x, y) => x - y)).toEqual([0, 7, 23, 49]);
    for (const exp of multi.expected) expectMarker(a, exp);
  });

  it('a frame with no markers gives an empty list, not an error', () => {
    const plain = texture(cv, W, H, { seed: 99, lo: 60, hi: 180 });
    const a = analyser.analyseGray(plain);
    expect(a.markers).toEqual([]);
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('sharpness of a blurred frame is much lower than of the sharp one', () => {
    const sharp = analyser.analyseGray(frame).sharpness;
    const soft = analyser.analyseGray(gaussianBlur(cv, frame, 1, 3)).sharpness;
    const softer = analyser.analyseGray(gaussianBlur(cv, frame, 1, 6)).sharpness;
    console.info(`[frame-analyser] sharpness sharp ${sharp.toFixed(1)}, blur σ3 ${soft.toFixed(1)}, blur σ6 ${softer.toFixed(1)}`);
    expect(soft).toBeLessThan(sharp * 0.5);
    expect(softer).toBeLessThan(soft);
  });
});

describe('FrameAnalyser corner accuracy', () => {
  /**
   * Fixed: corners used to be scaled with `v * scale` and had no sub-pixel refinement (up to
   * 2.5 px off). Now: CORNER_REFINE_SUBPIX plus `(v + 0.5) * scale - 0.5` (PLAN §3.3).
   */
  it('corners are within 0.5 px wherever the marker sits (sub-pixel refinement)', () => {
    let worst = 0;
    for (let x = 700; x < 708; x++) {
      for (const y of [386, 387]) {
        const m = markerFrame(cv, W, H, [{ id: ID, x, y, side: 216 }], { seed: 11 });
        const a = analyser.analyseGray(m.image);
        const hit = a.markers.find((k) => k.id === ID);
        expect(hit).toBeDefined();
        worst = Math.max(worst, maxCornerError(hit!.corners, m.expected[0]!.corners));
      }
    }
    console.info(`[frame-analyser] worst corner error over 16 positions: ${worst.toFixed(2)} px`);
    expect(worst).toBeLessThanOrEqual(0.5);
  });

  it('corners stay within the M1 tolerance wherever the marker sits', () => {
    for (let x = 700; x < 708; x++) {
      for (const y of [386, 387]) {
        const m = markerFrame(cv, W, H, [{ id: ID, x, y, side: 216 }], { seed: 11 });
        expectMarker(analyser.analyseGray(m.image), m.expected[0]!);
      }
    }
    expect(cvCounters.liveScoped).toBe(0);
  });
});

describe('FrameAnalyser.analyseRgba', () => {
  it('RGBA and BGRA buffers of the same picture give the same result', () => {
    // A colourful frame: R = G = the marker frame, B = an unrelated texture, so channel order matters.
    const blue = texture(cv, W, H, { seed: 7, lo: 0, hi: 255 });
    const rgba = grayToRgba(cv, frame, blue);
    const bgra = swapRedBlue(cv, rgba);
    const a = analyser.analyseRgba(rgba, 'RGBA');
    const b = analyser.analyseRgba(bgra, 'BGRA');
    expectMarker(a, expected);
    expect(b.markers).toEqual(a.markers);
    expect(b.sharpness).toBe(a.sharpness);
    // Reading the BGRA buffer as if it were RGBA gives a different grey image (order is honoured).
    const wrong = analyser.analyseRgba(bgra, 'RGBA');
    expect(wrong.sharpness).not.toBe(a.sharpness);
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('a neutral-grey RGBA frame matches the grey analysis within rounding', () => {
    const rgba = grayToRgba(cv, frame);
    const a = analyser.analyseRgba(rgba);
    const g = analyser.analyseGray(frame);
    expect(a.markers.map((m) => m.id)).toEqual(g.markers.map((m) => m.id));
    expect(maxCornerError(a.markers[0]!.corners, g.markers[0]!.corners)).toBeLessThan(0.01);
    expect(Math.abs(a.sharpness - g.sharpness) / g.sharpness).toBeLessThan(0.01);
  });

  it('works with a padded RGBA stride', () => {
    const rgba = grayToRgba(cv, frame);
    const padded = withStride(rgba, 4, W * 4 + 128);
    const a = analyser.analyseRgba(padded, 'RGBA');
    expectMarker(a, expected);
    expect(cvCounters.liveScoped).toBe(0);
  });
});

describe('FrameAnalyser memory discipline', () => {
  it('reuses its buffers: persistent object count is stable across frames of the same size', () => {
    analyser.analyseGray(frame);
    const n = cvCounters.livePersistent;
    for (let i = 0; i < 5; i++) analyser.analyseGray(frame);
    expect(cvCounters.livePersistent).toBe(n);
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('dispose() frees everything it created', () => {
    const before = cvCounters.livePersistent;
    const a = new FrameAnalyser(cv);
    expect(cvCounters.livePersistent).toBeGreaterThan(before);
    a.analyseGray(frame);
    a.analyseRgba(grayToRgba(cv, frame));
    a.dispose();
    expect(cvCounters.livePersistent).toBe(before);
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('only the shared analyser is still alive (baseline check)', () => {
    expect(cvCounters.livePersistent).toBeGreaterThan(persistentBefore);
    expect(cvCounters.liveScoped).toBe(0);
  });
});

describe('copyRows / ensureMat', () => {
  it('copyRows packs a padded buffer row by row and ignores the padding', () => {
    const src: PixelBuffer = { data: new Uint8Array([1, 2, 3, 99, 4, 5, 6, 99]), width: 3, height: 2, stride: 4 };
    const mat = new cv.Mat(2, 3, cv.CV_8UC1);
    try {
      copyRows(mat, src, 1);
      expect(Array.from(mat.data as Uint8Array)).toEqual([1, 2, 3, 4, 5, 6]);
    } finally {
      mat.delete();
    }
  });

  it('ensureMat reuses a matching Mat and replaces a mismatched one', () => {
    const before = cvCounters.livePersistent;
    const m1 = ensureMat(cv, null, 10, 20, cv.CV_8UC1);
    expect(cvCounters.livePersistent).toBe(before + 1);
    expect(ensureMat(cv, m1, 10, 20, cv.CV_8UC1)).toBe(m1);
    const m2 = ensureMat(cv, m1, 10, 21, cv.CV_8UC1);
    expect(m2).not.toBe(m1);
    expect(m2.cols).toBe(21);
    const m3 = ensureMat(cv, m2, 10, 21, cv.CV_8UC4);
    expect(m3).not.toBe(m2);
    expect(cvCounters.livePersistent).toBe(before + 1);
    m3.delete();
    cvCounters.livePersistent--;
  });
});
