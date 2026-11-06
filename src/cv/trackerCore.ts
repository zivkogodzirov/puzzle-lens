/**
 * The tracker's per-frame work (PLAN §3.1), kept apart from the worker so the leak test
 * (test/leak/live-loop.test.ts) runs exactly this code with counting fakes.
 *
 * Ownership rule: every VideoFrame / ImageBitmap handed to `processVideoFrame` / `processBitmap`
 * is closed exactly once, whatever happens — including every intermediate frame or bitmap made
 * here (GPU-scaled copies, thumbnails).
 */
import { locateOnTable } from '../geo/tableFix';
import type { MarkerMap } from '../project/types';
import { cvErrorMessage, wasmBytes, type Cv } from './loadCv';
import { upscaleCoord, type FrameAnalyser, type FrameAnalysis } from './frameAnalyser';
import { cvCounters } from './scope';
import type { ReadFrame } from '../shared/frameRead';
import type { FrameInfo, FrameSource, TrackerFrameResult, WorkerError, WorkerMemory } from '../shared/types';

export const ANALYSIS_WIDTH = 960;
/** Frames wider than this are shrunk on the GPU (createImageBitmap) before copying. */
export const MAX_DIRECT_COPY_WIDTH = 1280;
export const THUMB_EVERY_MS = 3000;
export const THUMB_KEEP = 6;
const THUMB_WIDTH = 480;
/** Big frames: frames per way timed before choosing (after a couple of warm-up frames each). */
const BIG_TRIAL_FRAMES = 10;
const BIG_TRIAL_SKIP = 2;

/**
 * How frames wider than MAX_DIRECT_COPY_WIDTH are read:
 *  - 'gpu': shrink on the GPU (createImageBitmap) and copy the small picture;
 *  - 'direct': copy the full frame's grey plane and shrink it in OpenCV.
 * On the owner's iPhone with the full-size tracker copy (needed for full-size photos) the GPU way
 * took ~47 ms per 4032×3024 frame. 'auto' times both on the phone and keeps the faster one.
 */
export type BigFramePath = 'auto' | 'direct' | 'gpu';

/** The few browser things the tracker needs, injectable so tests can count every frame. */
export interface TrackerEnv {
  readVideoFrame(frame: VideoFrame): Promise<ReadFrame | null>;
  createImageBitmap(src: VideoFrame | ImageBitmap, opts: ImageBitmapOptions): Promise<ImageBitmap>;
  /** Wraps a bitmap in a VideoFrame, or null where VideoFrame doesn't exist. */
  makeVideoFrame: ((bmp: ImageBitmap, timestamp: number) => VideoFrame) | null;
  /** A 2D canvas, or null where OffscreenCanvas doesn't exist. */
  makeCanvas: ((w: number, h: number) => OffscreenCanvas) | null;
  /** performance.now() */
  now(): number;
  /** Date.now()-style absolute time in ms. */
  nowAbs(): number;
}

/** The real browser/worker environment. */
export function browserTrackerEnv(readVideoFrame: TrackerEnv['readVideoFrame']): TrackerEnv {
  return {
    readVideoFrame,
    createImageBitmap: (src, opts) => createImageBitmap(src, opts),
    makeVideoFrame: typeof VideoFrame === 'undefined' ? null : (bmp, timestamp) => new VideoFrame(bmp, { timestamp }),
    makeCanvas: typeof OffscreenCanvas === 'undefined' ? null : (w, h) => new OffscreenCanvas(w, h),
    now: () => performance.now(),
    nowAbs: () => performance.timeOrigin + performance.now(),
  };
}

interface Analysed {
  analysis: FrameAnalysis;
  format: string | null;
  /** Factor from the analysed buffer back to the frame as received (GPU downscale). */
  scale: number;
}

export class TrackerCore {
  readonly counters = { received: 0, processed: 0, skipped: 0, errors: 0, openFrames: 0, openBitmaps: 0 };
  lastError: WorkerError | null = null;
  /** OpenCV/copy errors in a row without a good frame in between. */
  consecutiveErrors = 0;
  /** Absolute arrival times (ms) of recent frames, for the "camera paused during Snap" measurement. */
  readonly arrivals: number[] = [];
  readonly thumbs: Blob[] = [];
  private minIntervalMs = 0;
  private lastProcessedAt = Number.NEGATIVE_INFINITY;
  private lastThumbAt = Number.NEGATIVE_INFINITY;
  private frameIndex = 0;
  private bigPath: BigFramePath = 'auto';
  private readonly bigTrial: { direct: number[]; gpu: number[] } = { direct: [], gpu: [] };
  /** Median ms per frame for each way once chosen (for the HUD, Device check and reports). */
  bigChoice: { path: 'direct' | 'gpu'; directMs: number | null; gpuMs: number | null } | null = null;
  private tableMap: MarkerMap | null = null;
  private zoom = 1;

  constructor(
    private readonly cv: Cv,
    private readonly analyser: FrameAnalyser,
    private readonly env: TrackerEnv,
  ) {}

  /** The marker map of the current puzzle (null = none yet) and the camera zoom (1 or 2). */
  setTableMap(map: MarkerMap | null, zoom = 1): void {
    this.tableMap = map;
    this.zoom = zoom > 0 ? zoom : 1;
  }

  /** Measure the pieces in every frame (marker-free puzzles). */
  setPieceStats(on: boolean): void {
    this.analyser.pieceStats = on;
  }

  setRate(fps: number): void {
    this.minIntervalMs = fps > 0 ? 1000 / fps - 2 : 0;
  }

  memory(): WorkerMemory {
    return {
      wasmBytes: wasmBytes(this.cv),
      liveScoped: cvCounters.liveScoped,
      livePersistent: cvCounters.livePersistent,
      openFrames: this.counters.openFrames + this.counters.openBitmaps,
    };
  }

  /** Longest gap between camera frames inside [startAbs, endAbs] (ms since epoch). */
  maxFrameGap(startAbs: number, endAbs: number): number {
    const inside = this.arrivals.filter((t) => t >= startAbs && t <= endAbs);
    const pts = [startAbs, ...inside, endAbs];
    let max = 0;
    for (let i = 1; i < pts.length; i++) max = Math.max(max, pts[i]! - pts[i - 1]!);
    return max;
  }

  noteError(err: unknown): void {
    this.counters.errors++;
    this.consecutiveErrors++;
    this.lastError = { message: cvErrorMessage(this.cv, err), at: this.env.nowAbs() };
  }

  /** Direct path. Takes ownership of `frame`: it is always closed. Null = skipped or failed. */
  async processVideoFrame(frame: VideoFrame): Promise<TrackerFrameResult | null> {
    this.counters.received++;
    this.counters.openFrames++;
    this.noteArrival();
    try {
      const t0 = this.env.now();
      if (t0 - this.lastProcessedAt < this.minIntervalMs) {
        this.counters.skipped++;
        return null;
      }
      this.lastProcessedAt = t0;
      const res = await this.analyseVideoFrame(frame);
      if (!res) return null;
      const info = frameInfo(frame);
      const anyFrame = frame as unknown as { rotation?: number; flip?: boolean };
      const result = this.toResult(res, t0, {
        timestampUs: frame.timestamp,
        source: 'mstp',
        rotation: typeof anyFrame.rotation === 'number' ? anyFrame.rotation : null,
        flip: typeof anyFrame.flip === 'boolean' ? anyFrame.flip : null,
        frameInfo: info,
      });
      await this.maybeThumb(frame, frame.displayWidth);
      return result;
    } catch (err) {
      this.noteError(err);
      return null;
    } finally {
      frame.close();
      this.counters.openFrames--;
    }
  }

  /** Fallback path: a frame the main thread sent as an ImageBitmap. Takes ownership: always closed. */
  async processBitmap(bitmap: ImageBitmap, timestampUs: number): Promise<TrackerFrameResult | null> {
    this.counters.received++;
    this.counters.openBitmaps++;
    this.noteArrival();
    const t0 = this.env.now();
    try {
      let res: Analysed | null = null;
      if (this.env.makeVideoFrame) {
        const vf = this.env.makeVideoFrame(bitmap, timestampUs);
        this.counters.openFrames++;
        try {
          const read = await this.env.readVideoFrame(vf);
          if (read) res = { analysis: this.analyseRead(read), format: `bitmap:${read.format}`, scale: 1 };
        } finally {
          vf.close();
          this.counters.openFrames--;
        }
      }
      res ??= this.analyseViaCanvas(bitmap, bitmap.width, bitmap.height, 'bitmap', 1);
      if (!res) return null;
      const result = this.toResult(res, t0, { timestampUs, source: 'bitmap', rotation: null, flip: null, frameInfo: null });
      await this.maybeThumb(bitmap, bitmap.width);
      return result;
    } catch (err) {
      this.noteError(err);
      return null;
    } finally {
      bitmap.close();
      this.counters.openBitmaps--;
    }
  }

  recentThumbs(): Blob[] {
    return [...this.thumbs];
  }

  private noteArrival(): void {
    const t = this.env.nowAbs();
    this.arrivals.push(t);
    while (this.arrivals.length > 0 && t - this.arrivals[0]! > 30_000) this.arrivals.shift();
  }

  private analyseRead(read: ReadFrame): FrameAnalysis {
    const a = read.kind === 'gray' ? this.analyser.analyseGray(read.buffer) : this.analyser.analyseRgba(read.buffer, read.kind === 'rgba' ? 'RGBA' : 'BGRA');
    a.timings.read = read.copyMs;
    return a;
  }

  /** Forces one way of reading big frames (tests), or 'auto' to time both. */
  setBigFramePath(p: BigFramePath): void {
    this.bigPath = p;
    this.bigTrial.direct.length = 0;
    this.bigTrial.gpu.length = 0;
    this.bigChoice = null;
  }

  private nextBigPath(): 'direct' | 'gpu' {
    if (this.bigPath !== 'auto') return this.bigPath;
    // Alternate while timing.
    return this.bigTrial.direct.length <= this.bigTrial.gpu.length ? 'direct' : 'gpu';
  }

  private noteBigTime(path: 'direct' | 'gpu', ms: number): void {
    if (this.bigPath !== 'auto') return;
    this.bigTrial[path].push(ms);
    const need = BIG_TRIAL_FRAMES + BIG_TRIAL_SKIP;
    if (this.bigTrial.direct.length >= need && this.bigTrial.gpu.length >= need) {
      const med = (xs: number[]) => {
        const t = xs.slice(BIG_TRIAL_SKIP).sort((a, b) => a - b);
        return t[Math.floor(t.length / 2)]!;
      };
      const d = med(this.bigTrial.direct);
      const g = med(this.bigTrial.gpu);
      this.bigPath = d <= g ? 'direct' : 'gpu';
      this.bigChoice = { path: this.bigPath, directMs: d, gpuMs: g };
    }
  }

  /** Gets pixels from a frame and runs the analyser. Big frames: see BigFramePath. */
  private async analyseVideoFrame(frame: VideoFrame): Promise<Analysed | null> {
    const width = frame.displayWidth;
    if (width <= MAX_DIRECT_COPY_WIDTH || !this.env.makeVideoFrame) {
      const read = await this.env.readVideoFrame(frame);
      if (read) return { analysis: this.analyseRead(read), format: frame.format ?? read.format, scale: 1 };
      return this.analyseViaCanvas(frame, frame.displayWidth, frame.displayHeight, frame.format, 1);
    }
    if (this.nextBigPath() === 'direct') {
      // Copy the whole frame (only its grey plane is used) and let OpenCV shrink it.
      const t0 = this.env.now();
      const read = await this.env.readVideoFrame(frame);
      if (read) {
        const analysis = this.analyseRead(read);
        this.noteBigTime('direct', this.env.now() - t0);
        return { analysis, format: `${frame.format ?? read.format} full copy`, scale: 1 };
      }
      // Opaque frames can't be copied: only the GPU way works.
      if (this.bigPath === 'auto') this.setBigFramePath('gpu');
    }
    return this.analyseBigOnGpu(frame, width);
  }

  /** Big frame shrunk on the GPU, then the small picture copied. */
  private async analyseBigOnGpu(frame: VideoFrame, width: number): Promise<Analysed | null> {
    const tScale = this.env.now();
    const scaled = await this.env.createImageBitmap(frame, { resizeWidth: ANALYSIS_WIDTH, resizeQuality: 'medium' });
    this.counters.openBitmaps++;
    let target: VideoFrame | null = null;
    try {
      target = this.env.makeVideoFrame!(scaled, frame.timestamp);
      this.counters.openFrames++;
      const scaleMs = this.env.now() - tScale;
      const scale = width / scaled.width;
      const read = await this.env.readVideoFrame(target);
      const res = read
        ? { analysis: this.analyseRead(read), format: `${frame.format ?? 'opaque'}→scaled ${read.format ?? '?'}`, scale }
        : this.analyseViaCanvas(target, scaled.width, scaled.height, `${frame.format ?? 'opaque'}→scaled`, scale);
      if (res) {
        res.analysis.timings.scale = scaleMs;
        this.noteBigTime('gpu', this.env.now() - tScale);
      }
      return res;
    } finally {
      if (target) {
        target.close();
        this.counters.openFrames--;
      }
      scaled.close();
      this.counters.openBitmaps--;
    }
  }

  /** Last resort for opaque frames: draw into a canvas and read it back (may be noise-injected). */
  private analyseViaCanvas(src: VideoFrame | ImageBitmap, w: number, h: number, format: string | null, scale: number): Analysed | null {
    if (!this.env.makeCanvas) return null;
    const canvas = this.env.makeCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const analysis = this.analyser.analyseRgba({ data: img.data, width: w, height: h, stride: w * 4 }, 'RGBA');
    return { analysis, format: `${format ?? 'opaque'}→canvas`, scale };
  }

  private toResult(
    res: Analysed,
    t0: number,
    extra: Pick<TrackerFrameResult, 'timestampUs' | 'source' | 'rotation' | 'flip' | 'frameInfo'>,
  ): TrackerFrameResult {
    const { analysis, format, scale } = res;
    const markers = scale === 1 ? analysis.markers : analysis.markers.map((m) => ({ id: m.id, corners: m.corners.map((v) => upscaleCoord(v, scale)) }));
    const width = Math.round(analysis.inputWidth * scale);
    const height = Math.round(analysis.inputHeight * scale);
    let table: TrackerFrameResult['table'] = null;
    if (this.tableMap && markers.length) {
      const tt = this.env.now();
      table = locateOnTable(markers, this.tableMap, { width, height }, this.zoom);
      analysis.timings.table = this.env.now() - tt;
    }
    analysis.timings.total = this.env.now() - t0;
    // A good frame: the error streak is over (lastError stays, with its time, for the HUD to age out).
    this.consecutiveErrors = 0;
    this.counters.processed++;
    return {
      frameIndex: this.frameIndex++,
      timestampUs: extra.timestampUs,
      // The pixel space the corners are in: the analysed buffer, scaled back up.
      width,
      height,
      analysisWidth: analysis.analysisWidth,
      markers,
      sharpness: analysis.sharpness,
      timings: analysis.timings,
      source: extra.source,
      format,
      rotation: extra.rotation,
      flip: extra.flip,
      frameInfo: extra.frameInfo,
      table,
      pieces: analysis.pieces
        ? {
            ...analysis.pieces,
            medianAreaPx: analysis.pieces.medianAreaPx === null ? null : analysis.pieces.medianAreaPx * scale * scale,
            bbox: analysis.pieces.bbox ? (analysis.pieces.bbox.map((v) => v * scale) as [number, number, number, number]) : null,
          }
        : null,
    };
  }

  /** A small JPEG every few seconds for reports. Awaited while the source is still open. */
  private async maybeThumb(src: VideoFrame | ImageBitmap, width: number): Promise<void> {
    const t = this.env.nowAbs();
    if (t - this.lastThumbAt < THUMB_EVERY_MS || !this.env.makeCanvas) return;
    this.lastThumbAt = t;
    let bmp: ImageBitmap | null = null;
    try {
      bmp = await this.env.createImageBitmap(src, { resizeWidth: Math.min(THUMB_WIDTH, width), resizeQuality: 'low' });
      this.counters.openBitmaps++;
      const canvas = this.env.makeCanvas(bmp.width, bmp.height);
      (canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null)?.drawImage(bmp, 0, 0);
      bmp.close();
      this.counters.openBitmaps--;
      bmp = null;
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
      this.thumbs.push(blob);
      while (this.thumbs.length > THUMB_KEEP) this.thumbs.shift();
    } catch {
      /* thumbnails are best-effort */
    } finally {
      if (bmp) {
        bmp.close();
        this.counters.openBitmaps--;
      }
    }
  }
}

/** What the browser says about a VideoFrame (for the Device check and reports). */
export function frameInfo(frame: VideoFrame): FrameInfo {
  const r = frame.visibleRect;
  return {
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    displayWidth: frame.displayWidth,
    displayHeight: frame.displayHeight,
    visibleRect: r ? [r.x, r.y, r.width, r.height] : null,
  };
}
