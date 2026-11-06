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

/**
 * A quick look at the pieces in a live frame (no printed markers needed): dark-enough blobs on the
 * bright table. Pale pieces are missed here; this only feeds the gauge ("move lower", "fit all
 * pieces in"), never the catalog.
 */
export interface LivePieceStats {
  /** Blobs of piece size. */
  count: number;
  /** Median blob area in FRAME pixels² (null with fewer than 3 blobs). */
  medianAreaPx: number | null;
  /** Blobs touching the frame edge (pieces cut off). */
  atEdge: number;
  /** Bounding box of all blobs in frame px [x0, y0, x1, y1], or null. */
  bbox: [number, number, number, number] | null;
  /** Table brightness (0–255) the blobs were measured against. */
  tableGray: number;
}

export interface FrameAnalysis {
  markers: MarkerDetection[];
  pieces?: LivePieceStats;
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
  private mask: Mat | null = null;
  private labels: Mat | null = null;
  private stats: Mat | null = null;
  private centroids: Mat | null = null;
  private kernel: Mat | null = null;
  /** Also measure the pieces in each frame (marker-free mode). */
  pieceStats = false;

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
    // A whole-number shrink factor when it fits (e.g. 4032×3024 → 1008×756 = exactly ¼): OpenCV's
    // area shrink is many times faster then (measured on the Mac: 57 ms → a few ms for 12 MP).
    let aw = Math.min(this.opts.analysisWidth, width);
    const k = Math.round(width / this.opts.analysisWidth);
    if (k >= 2 && width % k === 0 && height % k === 0) aw = width / k;
    const scale = width / aw;
    let src: Mat = this.gray!;
    if (aw < width) {
      const ah = width % aw === 0 && height % (width / aw) === 0 ? height / (width / aw) : Math.max(1, Math.round(height / scale));
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

    let pieces: LivePieceStats | undefined;
    if (this.pieceStats) {
      t = performance.now();
      pieces = this.measurePieces(src, scale);
      timings.pieces = performance.now() - t;
    }
    return { markers, pieces, sharpness, analysisWidth: aw, inputWidth: width, inputHeight: height, timings };
  }

  private measurePieces(src: Mat, scale: number): LivePieceStats {
    const cv = this.cv;
    const w = src.cols;
    const h = src.rows;
    // The table is the brightest common grey: the histogram's peak in the upper half.
    const hist = new Uint32Array(256);
    const d = src.data;
    for (let i = 0; i < d.length; i += 3) hist[d[i]!]!++;
    let tableGray = 128;
    for (let v = 255, best = -1; v >= 64; v--) {
      if (hist[v]! > best) {
        best = hist[v]!;
        tableGray = v;
      }
    }
    const thr = Math.max(0, tableGray - Math.max(18, 0.12 * tableGray));
    this.mask ??= persistent(new cv.Mat());
    this.labels ??= persistent(new cv.Mat());
    this.stats ??= persistent(new cv.Mat());
    this.centroids ??= persistent(new cv.Mat());
    this.kernel ??= persistent(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)));
    cv.threshold(src, this.mask, thr, 255, cv.THRESH_BINARY_INV);
    cv.morphologyEx(this.mask, this.mask, cv.MORPH_OPEN, this.kernel);
    const n = cv.connectedComponentsWithStats(this.mask, this.labels, this.stats, this.centroids, 8, cv.CV_32S) as number;
    const s = Int32Array.from((this.stats as unknown as { data32S: Int32Array }).data32S);
    const areas: number[] = [];
    const edgeAreas: number[] = [];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const maxArea = 0.05 * w * h;
    for (let i = 1; i < n; i++) {
      const left = s[i * 5]!;
      const top = s[i * 5 + 1]!;
      const bw = s[i * 5 + 2]!;
      const bh = s[i * 5 + 3]!;
      const area = s[i * 5 + 4]!;
      if (area < 12 || area > maxArea) continue;
      areas.push(area);
      if (left <= 0 || top <= 0 || left + bw >= w || top + bh >= h) edgeAreas.push(area);
      x0 = Math.min(x0, left);
      y0 = Math.min(y0, top);
      x1 = Math.max(x1, left + bw);
      y1 = Math.max(y1, top + bh);
    }
    areas.sort((a, b) => a - b);
    // Only piece-sized blobs at the edge count as "pieces cut off" (not a strip of floor, a mug or an arm).
    const med = areas.length ? areas[Math.floor(areas.length / 2)]! : 0;
    const atEdge = edgeAreas.filter((a) => a >= 0.3 * med && a <= 3 * med).length;
    return {
      count: areas.length,
      medianAreaPx: areas.length >= 3 ? areas[Math.floor(areas.length / 2)]! * scale * scale : null,
      atEdge,
      bbox: areas.length ? [x0 * scale, y0 * scale, x1 * scale, y1 * scale] : null,
      tableGray,
    };
  }

  dispose(): void {
    for (const m of [this.detector, this.refine, this.params, this.dictionary, this.small, this.lap, this.mask, this.labels, this.stats, this.centroids, this.kernel]) if (m) freePersistent(m);
    this.mask = this.labels = this.stats = this.centroids = this.kernel = null;
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
