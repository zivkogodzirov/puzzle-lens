/**
 * Per-frame analysis for the live camera (runs in the tracker worker; also in Node tests).
 * M1: downscale, find printed markers (ArUco DICT_4X4_50), measure sharpness.
 * Later milestones add the table homography and optical flow on top of this.
 */
import { cvGuard, type Cv } from './loadCv';
import { freePersistent, persistent, withScope } from './scope';
import type { MarkerDetection, StageTimings } from '../shared/types';

export interface PixelBuffer {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  /** Bytes per row (may be larger than width × channels). */
  stride: number;
}

export interface FrameAnalysis {
  markers: MarkerDetection[];
  sharpness: number;
  analysisWidth: number;
  /** Size of the image that was passed in (the pixel space the marker corners are in). */
  inputWidth: number;
  inputHeight: number;
  timings: StageTimings;
}

/**
 * Maps a coordinate from an image shrunk by `scale` back to the bigger image, treating pixels as
 * squares whose centres are at .5 (OpenCV's convention): plain `v * scale` is off by up to
 * (scale − 1) / 2 pixels.
 */
export function upscaleCoord(v: number, scale: number): number {
  return scale === 1 ? v : (v + 0.5) * scale - 0.5;
}

export interface FrameAnalyserOptions {
  /** Frames wider than this are shrunk before analysis (RESEARCH §5: ~960 px is plenty for markers). */
  analysisWidth: number;
}

const DEFAULTS: FrameAnalyserOptions = { analysisWidth: 960 };

type Mat = { delete(): void; isDeleted?(): boolean; data: Uint8Array; rows: number; cols: number };

export class FrameAnalyser {
  private readonly cv: Cv;
  private readonly opts: FrameAnalyserOptions;
  private gray: Mat | null = null;
  private rgba: Mat | null = null;
  private small: Mat | null = null;
  private lap: Mat | null = null;
  private detector: { delete(): void; detectMarkers: (...a: unknown[]) => void } | null = null;
  private dictionary: Mat | null = null;
  private params: Mat | null = null;
  private refine: Mat | null = null;

  constructor(cv: Cv, opts: Partial<FrameAnalyserOptions> = {}) {
    this.cv = cv;
    this.opts = { ...DEFAULTS, ...opts };
    this.dictionary = persistent(cv.getPredefinedDictionary(cv.DICT_4X4_50));
    this.params = persistent(new cv.aruco_DetectorParameters());
    // Sub-pixel corners (PLAN §3.3): ~0.2 px instead of ~2.5 px error on a 1920→960 frame.
    (this.params as unknown as { cornerRefinementMethod: number }).cornerRefinementMethod = cv.CORNER_REFINE_SUBPIX ?? 1;
    this.refine = persistent(new cv.aruco_RefineParameters(10, 3, true));
    this.detector = persistent(new cv.aruco_ArucoDetector(this.dictionary, this.params, this.refine));
    this.small = persistent(new cv.Mat());
    this.lap = persistent(new cv.Mat());
  }

  /** Analyse a single-channel (luma) image, e.g. the Y plane of an NV12 camera frame. */
  analyseGray(img: PixelBuffer): FrameAnalysis {
    return cvGuard(this.cv, () => {
      const t0 = performance.now();
      this.gray = ensureMat(this.cv, this.gray, img.height, img.width, this.cv.CV_8UC1);
      copyRows(this.gray, img, 1);
      const tCopy = performance.now();
      const result = this.analyseLoaded(img.width, img.height);
      result.timings.copy = tCopy - t0;
      return result;
    });
  }

  /** Analyse a 4-channel image (RGBA or BGRA; both give the same grey within rounding). */
  analyseRgba(img: PixelBuffer, order: 'RGBA' | 'BGRA' = 'RGBA'): FrameAnalysis {
    const cv = this.cv;
    return cvGuard(cv, () => {
      const t0 = performance.now();
      this.rgba = ensureMat(cv, this.rgba, img.height, img.width, cv.CV_8UC4);
      copyRows(this.rgba, img, 4);
      this.gray = ensureMat(cv, this.gray, img.height, img.width, cv.CV_8UC1);
      cv.cvtColor(this.rgba, this.gray, order === 'RGBA' ? cv.COLOR_RGBA2GRAY : cv.COLOR_BGRA2GRAY);
      const tCopy = performance.now();
      const result = this.analyseLoaded(img.width, img.height);
      result.timings.copy = tCopy - t0;
      return result;
    });
  }

  private analyseLoaded(width: number, height: number): FrameAnalysis {
    const cv = this.cv;
    const timings: StageTimings = {};
    let t = performance.now();

    // 1. Downscale
    const aw = Math.min(this.opts.analysisWidth, width);
    const scale = width / aw;
    let src: Mat = this.gray!;
    if (aw < width) {
      const ah = Math.max(1, Math.round(height / scale));
      cv.resize(this.gray, this.small, new cv.Size(aw, ah), 0, 0, cv.INTER_AREA);
      src = this.small!;
    }
    timings.resize = performance.now() - t;

    // 2. Markers
    t = performance.now();
    const markers = withScope((s) => {
      const corners = s.keep(new cv.MatVector());
      const ids = s.keep(new cv.Mat());
      const rejected = s.keep(new cv.MatVector());
      this.detector!.detectMarkers(src, corners, ids, rejected);
      const found: MarkerDetection[] = [];
      const n = corners.size() as number;
      // Copy the ids out first: corners.get() allocates, and if WASM memory grows the old view goes dead.
      const idData = Int32Array.from(ids.data32S as Int32Array);
      for (let i = 0; i < n; i++) {
        const c = s.keep(corners.get(i));
        const f: Float32Array = c.data32F;
        const pts: number[] = [];
        for (let k = 0; k < 8; k++) pts.push(upscaleCoord(f[k] ?? 0, scale));
        found.push({ id: idData[i] ?? -1, corners: pts });
      }
      return found;
    });
    timings.markers = performance.now() - t;

    // 3. Sharpness = variance of the Laplacian
    t = performance.now();
    const sharpness = withScope((s) => {
      cv.Laplacian(src, this.lap, cv.CV_16S, 3);
      const mean = s.keep(new cv.Mat());
      const std = s.keep(new cv.Mat());
      cv.meanStdDev(this.lap, mean, std);
      const sd = std.data64F[0] ?? 0;
      return sd * sd;
    });
    timings.sharpness = performance.now() - t;

    return { markers, sharpness, analysisWidth: aw, inputWidth: width, inputHeight: height, timings };
  }

  dispose(): void {
    for (const m of [this.detector, this.refine, this.params, this.dictionary, this.small, this.lap]) freePersistent(m);
    if (this.gray) freePersistent(this.gray);
    if (this.rgba) freePersistent(this.rgba);
    this.detector = this.refine = this.params = this.dictionary = this.small = this.lap = this.gray = this.rgba = null;
  }
}

/** Reuses `mat` if it already has the right size and type, otherwise replaces it. */
export function ensureMat(cv: Cv, mat: Mat | null, rows: number, cols: number, type: number): Mat {
  if (mat && mat.rows === rows && mat.cols === cols && (mat as unknown as { type(): number }).type() === type) return mat;
  if (mat) freePersistent(mat);
  return persistent(new cv.Mat(rows, cols, type));
}

/** Copies a (possibly padded) pixel buffer into a continuous Mat, row by row if needed. */
export function copyRows(mat: Mat, img: PixelBuffer, channels: number): void {
  const rowBytes = img.width * channels;
  const dst = mat.data; // fresh view: safe even if WASM memory grew since last frame
  if (img.stride === rowBytes) {
    dst.set(img.data.subarray(0, rowBytes * img.height));
    return;
  }
  for (let y = 0; y < img.height; y++) {
    const start = y * img.stride;
    dst.set(img.data.subarray(start, start + rowBytes), y * rowBytes);
  }
}
