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

type FrameReader = ReadableStreamDefaultReader<VideoFrame>;
type ProcessorCtor = new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };

let core: TrackerCore | null = null;
let initError: WorkerError | null = null;
let source: FrameSource | null = null;
let pendingRate = 0;
let pendingMap: { map: MarkerMap | null; zoom: number } = { map: null, zoom: 1 };
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
      return { ok: true, cvLoadMs: cvLoadMs(), capabilities };
    } catch (err) {
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

  setTableMap(map: MarkerMap | null, zoom: number): void {
    pendingMap = { map, zoom };
    core?.setTableMap(map, zoom);
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
