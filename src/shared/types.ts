/** Types shared between the main thread and the workers. Keep this file free of DOM-only APIs. */

export type StageTimings = Record<string, number>;

export interface MarkerDetection {
  id: number;
  /** 4 corners (x0,y0,…,x3,y3) in the coordinates of the original camera frame. */
  corners: number[];
}

export interface TrackerFrameResult {
  frameIndex: number;
  /** VideoFrame timestamp in microseconds, or performance.now()*1000 for the bitmap path. */
  timestampUs: number;
  /**
   * Size of the pixel space the marker corners are in (the frame as the worker received it, before
   * any downscaling for analysis). Use this, not the video element size, to map corners on screen.
   */
  width: number;
  height: number;
  /** Size of the image the analysis ran on (downscaled). */
  analysisWidth: number;
  markers: MarkerDetection[];
  /** Variance of the Laplacian on the analysis image: higher = sharper. */
  sharpness: number;
  timings: StageTimings;
  source: FrameSource;
  /**
   * VideoFrame pixel format reported by the browser (e.g. "NV12"), or "bitmap". When the frame had
   * to be GPU-scaled first it reads like "NV12→scaled BGRA" so reports say what was measured.
   */
  format: string | null;
  /** Rotation the VideoFrame reports (0/90/180/270), or null when the browser doesn't say (WebKit 27.2). */
  rotation: number | null;
  /** Whether the VideoFrame says it is mirrored, or null when unknown. */
  flip: boolean | null;
  /** What the browser reported about the frame, recorded for the Device check and reports. */
  frameInfo: FrameInfo | null;
}

export interface FrameInfo {
  codedWidth: number;
  codedHeight: number;
  displayWidth: number;
  displayHeight: number;
  /** x, y, width, height of the visible part of the coded frame. */
  visibleRect: [number, number, number, number] | null;
}

/** An error a worker reported, with when it happened (Date.now()). */
export interface WorkerError {
  message: string;
  at: number;
}

export type FrameSource = 'mstp' | 'bitmap';

/** Memory and object counters a worker reports for the HUD and the leak tests. */
export interface WorkerMemory {
  /** Size of the OpenCV WebAssembly heap in bytes (never shrinks). */
  wasmBytes: number;
  /** OpenCV objects created per frame/job that have not been deleted yet. */
  liveScoped: number;
  /** Long-lived OpenCV objects (detectors, reusable buffers). */
  livePersistent: number;
  /** VideoFrames / ImageBitmaps received but not yet closed. */
  openFrames: number;
}

export interface TrackerStatus {
  running: boolean;
  source: FrameSource | null;
  framesReceived: number;
  framesProcessed: number;
  framesSkipped: number;
  memory: WorkerMemory;
  /** The most recent error, cleared again when the next frame is processed successfully. */
  lastError: WorkerError | null;
  /** OpenCV errors in a row without a good frame in between (the tracker restarts itself past a limit). */
  consecutiveErrors: number;
}

export interface WorkerInitInfo {
  ok: boolean;
  cvLoadMs: number;
  error?: string;
  /** What this worker can do (for the Device check). */
  capabilities: WorkerCapabilities;
}

export interface WorkerCapabilities {
  mediaStreamTrackProcessor: boolean;
  videoFrame: boolean;
  offscreenCanvas2d: boolean;
  offscreenCanvasWebgl: boolean;
  offscreenCanvasWebgl2: boolean;
  createImageBitmap: boolean;
  webgpu: boolean;
  indexedDb: boolean;
}

/** Statistics of one photo, computed tile by tile so a 12 MP image never sits in memory twice. */
export interface PhotoStats {
  /** The photo's real size (as displayed, EXIF orientation applied). */
  width: number;
  height: number;
  /** When the photo was too big to decode at full size: the reduced size it was checked at. */
  checkedAt?: [number, number] | null;
  bytes: number;
  type: string;
  decodeMs: number;
  analyseMs: number;
  tiles: number;
  tileSize: number;
  /** Mean luminance 0..255. */
  meanLuma: number;
  /** Share of pixels at or above 250 (blown out). */
  clippedHigh: number;
  /** Share of pixels at or below 5 (crushed black). */
  clippedLow: number;
  /** Median of per-tile Laplacian variance. */
  sharpness: number;
  readMethod: 'videoframe' | 'canvas';
  wasmBytesAfter: number;
}

export interface TwoXResult {
  /** Fine-detail energy of the 2× photo divided by that of the 1× centre crop enlarged 2×. */
  ratio: number;
  /** Provisional (thresholds not yet checked on a real iPhone): never shown to the owner as a verdict. */
  verdict: 'true-2x' | 'digital-zoom' | 'unclear';
  oneXSize: [number, number];
  twoXSize: [number, number];
}

export interface CvBenchResult {
  loadMs: number;
  stages: Array<{ name: string; size: string; ms: number }>;
  wasmBytesAfter: number;
}
