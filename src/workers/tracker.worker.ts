/// <reference lib="webworker" />
/**
 * TRACKER worker (PLAN §3.1): receives live camera frames and finds the printed markers.
 * It does nothing else, so it can keep up with the camera. Frames arrive either directly from a
 * cloned camera track (MediaStreamTrackProcessor, iOS 18+) or as ImageBitmaps sent by the main
 * thread (fallback). The per-frame work lives in src/cv/trackerCore.ts (shared with the leak test).
 */
import * as Comlink from 'comlink';
import { cvLoadMs, loadCv } from '../cv/loadCv';
import { FrameAnalyser } from '../cv/frameAnalyser';
import { ANALYSIS_WIDTH, browserTrackerEnv, TrackerCore } from '../cv/trackerCore';
import { readVideoFrame } from '../shared/frameRead';
import { probeWorkerCapabilities } from '../shared/workerCaps';
import type { FrameSource, TrackerFrameResult, TrackerStatus, WorkerError, WorkerInitInfo } from '../shared/types';
import type { TrackerApi } from '../shared/apis';
import type { MarkerMap } from '../project/types';
import type { AnchorPhoto } from '../shared/apis';
import { ANCHOR, upscaleH } from '../cv/anchor';
import { decodeAtMost } from '../cv/rectify';
import { mulH } from '../geo/homography';

type FrameReader = ReadableStreamDefaultReader<VideoFrame>;
type ProcessorCtor = new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };

let core: TrackerCore | null = null;
let initError: WorkerError | null = null;
let source: FrameSource | null = null;
let pendingRate = 0;
let pendingPieceStats = false;
let pendingMap: { map: MarkerMap | null; zoom: number } = { map: null, zoom: 1 };
let coreReady: (ok: boolean) => void = () => {};
const coreReadyP = new Promise<boolean>((r) => (coreReady = r));
/** Bumped by every attach/detach; a loop keeps running only while it still holds the current number. */
let loopGen = 0;
/** The one direct-frames loop that may be running. */
let active: { gen: number; reader: FrameReader; done: Promise<void> } | null = null;

/** One direct-frames loop. Its state is local, so an old loop can never touch a newer one. */
async function runLoop(gen: number, reader: FrameReader, track: MediaStreamTrack, onResult: (r: TrackerFrameResult) => void): Promise<void> {
  try {
    while (gen === loopGen) {
      const { value: frame, done } = await reader.read();
      if (done || !frame) break;
      if (gen !== loopGen || !core) {
        frame.close();
        break;
      }
      const r = await core.processVideoFrame(frame);
      if (r && gen === loopGen) onResult(r);
    }
  } catch (err) {
    core?.noteError(err);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      track.stop();
    } catch {
      /* ignore */
    }
    if (active?.gen === gen) active = null;
  }
}

/** Stops the running loop (if any) and waits until it has fully finished and stopped its track. */
async function stopActive(): Promise<void> {
  loopGen++;
  const a = active;
  if (!a) return;
  try {
    await a.reader.cancel();
  } catch {
    /* already closed */
  }
  await a.done.catch(() => {});
}

const api: TrackerApi = {
  async init(): Promise<WorkerInitInfo> {
    const capabilities = await probeWorkerCapabilities();
    try {
      const cv = await loadCv();
      core = new TrackerCore(cv, new FrameAnalyser(cv, { analysisWidth: ANALYSIS_WIDTH }), browserTrackerEnv(readVideoFrame));
      core.setRate(pendingRate);
      core.setTableMap(pendingMap.map, pendingMap.zoom);
      core.setPieceStats(pendingPieceStats);
      coreReady(true);
      return { ok: true, cvLoadMs: cvLoadMs(), capabilities };
    } catch (err) {
      coreReady(false);
      initError = { message: String(err), at: Date.now() };
      return { ok: false, cvLoadMs: 0, error: String(err), capabilities };
    }
  },

  /**
   * Takes ownership of a cloned camera track and reads frames from it until detach().
   * Answers ok only once the frame reader really exists; on failure the track is stopped and the
   * main thread falls back to sending bitmaps.
   */
  async attachTrack(track: MediaStreamTrack, onResult: (r: TrackerFrameResult) => void): Promise<{ ok: boolean; error?: string }> {
    await stopActive();
    if (!core) {
      track.stop();
      return { ok: false, error: 'The image engine is not ready' };
    }
    let reader: FrameReader;
    try {
      const Processor = (globalThis as unknown as { MediaStreamTrackProcessor?: ProcessorCtor }).MediaStreamTrackProcessor;
      if (!Processor) throw new Error('MediaStreamTrackProcessor is not available in this worker');
      reader = new Processor({ track }).readable.getReader();
    } catch (err) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
      return { ok: false, error: String(err) };
    }
    const gen = ++loopGen;
    source = 'mstp';
    active = { gen, reader, done: runLoop(gen, reader, track, onResult) };
    return { ok: true };
  },

  /** Fallback path: one frame sent by the main thread as an ImageBitmap. */
  async processBitmap(bitmap: ImageBitmap, timestampUs: number): Promise<TrackerFrameResult | null> {
    if (!core) {
      bitmap.close();
      return null;
    }
    source = 'bitmap';
    return core.processBitmap(bitmap, timestampUs);
  },

  async detach(): Promise<void> {
    await stopActive();
  },

  setRate(fps: number): void {
    pendingRate = fps;
    core?.setRate(fps);
  },

  setPieceStats(on: boolean): void {
    pendingPieceStats = on;
    core?.setPieceStats(on);
  },

  setTableMap(map: MarkerMap | null, zoom: number): void {
    pendingMap = { map, zoom };
    core?.setTableMap(map, zoom);
  },

  async setAnchor(refs: AnchorPhoto[] | null): Promise<{ features: number; photos: number; ms: number; error?: string }> {
    const t0 = performance.now();
    if (!(await coreReadyP) || !core) return { features: 0, photos: 0, ms: 0, error: 'The image engine is not ready' };
    if (!refs?.length) {
      core.setAnchor(null);
      return { features: 0, photos: 0, ms: 0 };
    }
    try {
      const pics = [];
      for (const r of refs) {
        const bmp = await decodeAtMost(r.blob, { width: r.width, height: r.height }, ANCHOR.refMaxSide);
        try {
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(bmp, 0, 0);
          const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
          pics.push({
            pixels: { data: new Uint8Array(img.data.buffer), width: bmp.width, height: bmp.height, stride: bmp.width * 4 },
            channels: 4 as const,
            imgToTable: mulH(r.imgToTable, upscaleH(r.width / bmp.width)),
          });
        } finally {
          bmp.close();
        }
      }
      const features = core.setAnchor(pics);
      return { features, photos: pics.length, ms: performance.now() - t0 };
    } catch (err) {
      core.setAnchor(null);
      return { features: 0, photos: 0, ms: performance.now() - t0, error: String((err as Error)?.message ?? err) };
    }
  },

  /** Longest gap between camera frames inside [startAbs, endAbs] (ms since epoch). */
  maxFrameGap(startAbs: number, endAbs: number): number {
    return core ? core.maxFrameGap(startAbs, endAbs) : endAbs - startAbs;
  },

  status(): TrackerStatus {
    const c = core?.counters;
    return {
      running: active !== null,
      source,
      framesReceived: c?.received ?? 0,
      framesProcessed: c?.processed ?? 0,
      framesSkipped: c?.skipped ?? 0,
      memory: core?.memory() ?? { wasmBytes: 0, liveScoped: 0, livePersistent: 0, openFrames: 0 },
      lastError: core?.lastError ?? initError,
      consecutiveErrors: core?.consecutiveErrors ?? 0,
      bigFrames: core?.bigChoice ?? null,
    };
  },

  recentFrames(): Blob[] {
    return core?.recentThumbs() ?? [];
  },
};

Comlink.expose(api);
