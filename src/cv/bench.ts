/**
 * OpenCV speed benchmark for the Device check (RESEARCH §19 item 11). The same function runs
 * in Node during tests, which gives the phone-to-Mac speed factor used by timing tests.
 */
import type { Cv } from './loadCv';
import { cvGuard, wasmBytes } from './loadCv';
import { withScope } from './scope';
import { FrameAnalyser } from './frameAnalyser';
import type { CvBenchResult } from '../shared/types';

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function time(fn: () => void, reps = 3): number {
  fn(); // warm-up
  const ts: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    fn();
    ts.push(performance.now() - t0);
  }
  return median(ts);
}

/**
 * Deterministic test image: gradient + checker blocks + noise-like texture + one printed marker.
 * Built with OpenCV operations (no per-pixel JavaScript loop over the full image, which is slow on
 * iOS): the texture is a small 128×128 tile repeated across the image.
 */
export function makeBenchImage(cv: Cv, width: number, height: number, s: { keep<T extends { delete(): void }>(o: T): T }) {
  // Gradient: a 2×2 image enlarged with linear interpolation.
  const corners = s.keep(cv.matFromArray(2, 2, cv.CV_8UC1, [0, 128, 128, 255]));
  const img = s.keep(new cv.Mat());
  cv.resize(corners, img, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR);
  // Checker blocks of 64 px: a 2×2 checker enlarged with nearest-neighbour, then tiled.
  const checker = s.keep(cv.matFromArray(2, 2, cv.CV_8UC1, [0, 40, 40, 0]));
  const cell = s.keep(new cv.Mat());
  cv.resize(checker, cell, new cv.Size(128, 128), 0, 0, cv.INTER_NEAREST);
  // Texture: 128×128 pseudo-random values 0–31 (16 k iterations, not 2 M).
  const T = 128;
  const noise = s.keep(new cv.Mat(T, T, cv.CV_8UC1));
  const nd: Uint8Array = noise.data;
  let seed = 12345;
  for (let i = 0; i < T * T; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    nd[i] = seed & 31;
  }
  const tile = s.keep(new cv.Mat());
  cv.add(cell, noise, tile);
  const tiled = s.keep(new cv.Mat());
  cv.repeat(tile, Math.ceil(height / T), Math.ceil(width / T), tiled);
  const tiledRoi = s.keep(tiled.roi(new cv.Rect(0, 0, width, height)));
  cv.add(img, tiledRoi, img);
  const dict = s.keep(cv.getPredefinedDictionary(cv.DICT_4X4_50));
  const side = Math.round(Math.min(width, height) / 5);
  const marker = s.keep(new cv.Mat());
  cv.generateImageMarker(dict, 7, side, marker, 1);
  const pad = Math.round(side / 5);
  const bg = s.keep(new cv.Mat(side + 2 * pad, side + 2 * pad, cv.CV_8UC1, new cv.Scalar(255)));
  const inner = s.keep(bg.roi(new cv.Rect(pad, pad, side, side)));
  marker.copyTo(inner);
  const dst = s.keep(img.roi(new cv.Rect(Math.round(width / 3), Math.round(height / 3), side + 2 * pad, side + 2 * pad)));
  bg.copyTo(dst);
  return img;
}

export function runCvBench(cv: Cv, loadMs: number): CvBenchResult {
  const stages: CvBenchResult['stages'] = [];
  cvGuard(cv, () => withScope((s) => {
    const W = 1920;
    const H = 1080;
    const gray = makeBenchImage(cv, W, H, s);
    const rgba = s.keep(new cv.Mat());
    cv.cvtColor(gray, rgba, cv.COLOR_GRAY2RGBA);
    const out = s.keep(new cv.Mat());
    const out2 = s.keep(new cv.Mat());
    const size = `${W}×${H}`;

    stages.push({ name: 'Colour → grey', size, ms: time(() => cv.cvtColor(rgba, out, cv.COLOR_RGBA2GRAY)) });
    stages.push({ name: 'Blur 5×5', size, ms: time(() => cv.GaussianBlur(gray, out, new cv.Size(5, 5), 0)) });
    stages.push({ name: 'Threshold (Otsu)', size, ms: time(() => cv.threshold(gray, out, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU)) });
    const kernel = s.keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5)));
    stages.push({ name: 'Morphology open', size, ms: time(() => cv.morphologyEx(out, out2, cv.MORPH_OPEN, kernel)) });
    stages.push({
      name: 'Find outlines',
      size,
      ms: time(() =>
        withScope((t) => {
          const contours = t.keep(new cv.MatVector());
          const hier = t.keep(new cv.Mat());
          cv.findContours(out2, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
        }),
      ),
    });
    const M = s.keep(cv.matFromArray(3, 3, cv.CV_64F, [1, 0.02, 5, -0.01, 1, 3, 0, 0, 1]));
    stages.push({ name: 'Perspective warp', size, ms: time(() => cv.warpPerspective(gray, out, M, new cv.Size(W, H))) });

    const analyser = new FrameAnalyser(cv, { analysisWidth: 960 });
    try {
      const view = gray.data as Uint8Array;
      const buf = { data: view.slice(), width: W, height: H, stride: W };
      stages.push({ name: 'Live frame (shrink + markers + sharpness)', size: `${W}×${H}→960`, ms: time(() => analyser.analyseGray(buf)) });
    } finally {
      analyser.dispose();
    }

    // Optical flow: 200 points between the image and a slightly shifted copy.
    const shifted = s.keep(new cv.Mat());
    const T = s.keep(cv.matFromArray(2, 3, cv.CV_64F, [1, 0, 3, 0, 1, 2]));
    cv.warpAffine(gray, shifted, T, new cv.Size(W, H));
    const pts = s.keep(new cv.Mat());
    cv.goodFeaturesToTrack(gray, pts, 200, 0.01, 10);
    stages.push({
      name: 'Optical flow (200 points)',
      size,
      ms: time(() =>
        withScope((t) => {
          const next = t.keep(new cv.Mat());
          const st = t.keep(new cv.Mat());
          const err = t.keep(new cv.Mat());
          cv.calcOpticalFlowPyrLK(gray, shifted, pts, next, st, err, new cv.Size(21, 21), 3);
        }),
      ),
    });

    // A 12 MP grey photo: shrink + sharpness, as used on Snaps.
    const big = s.keep(new cv.Mat());
    cv.resize(gray, big, new cv.Size(4032, 3024), 0, 0, cv.INTER_LINEAR);
    stages.push({ name: 'Photo shrink 12 MP → ¼', size: '4032×3024', ms: time(() => cv.resize(big, out, new cv.Size(1008, 756), 0, 0, cv.INTER_AREA), 1) });
    stages.push({
      name: 'Photo sharpness 12 MP',
      size: '4032×3024',
      ms: time(() => withScope((t) => {
        const lap = t.keep(new cv.Mat());
        cv.Laplacian(big, lap, cv.CV_16S, 3);
      }), 1),
    });
  }));
  return { loadMs, stages, wasmBytesAfter: wasmBytes(cv) };
}
