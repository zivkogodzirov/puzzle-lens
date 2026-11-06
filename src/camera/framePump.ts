/**
 * Feeds live camera frames to the tracker worker.
 * Preferred: a CLONE of the camera track is transferred to the worker, which reads frames itself
 * (MediaStreamTrackProcessor, iOS 18+): no pixels pass through the main thread.
 * Fallback: on each video frame the main thread makes a small ImageBitmap and sends it.
 *
 * Safety nets (review fixes):
 *  - every start is numbered; a start that is overtaken by stopPump()/another start gives back
 *    what it opened and changes nothing;
 *  - stopPump() never throws and always resets its state;
 *  - if direct frames stop arriving while the camera is fine, switch to the fallback;
 *  - if the tracker keeps failing, restart its worker (a few times), then tell the owner.
 */
import { signal } from '@preact/signals';
import { Comlink, peekReader, peekTracker, restartTracker, trackerWorker } from '../app/workers';
import { settings } from '../app/settings';
import { hud, RateMeter, recordTrackerResult } from '../perf/hud';
import { logInfo, logWarn } from '../log/logger';
import { rvfc } from '../types/media';
import { cameraState, currentTrack, snapping } from './camera';
import { wantsFullSizeTracking } from './snapMethod';
import type { TrackerFrameResult, TrackerStatus } from '../shared/types';

export type PumpMode = 'off' | 'mstp' | 'bitmap';
export const pumpMode = signal<PumpMode>('off');
export const latestFrame = signal<TrackerFrameResult | null>(null);
/** A plain-English problem with live tracking for the Live screen, or null when all is well. */
export const pumpError = signal<string | null>(null);
/** performance.now() when the latest result arrived. */
export let latestFrameAt = 0;

const FALLBACK_WIDTH = 960;
/** Direct path: no new frame for this long while the camera is fine → switch to the fallback. */
const STALL_MS = 4000;
/** This many tracker errors in a row → restart the tracker worker. */
const MAX_CONSECUTIVE_ERRORS = 30;
const MAX_TRACKER_RESTARTS = 3;
/** How long a tracker error stays visible on the HUD. */
const ERROR_SHOW_MS = 5000;

let video: HTMLVideoElement | null = null;
let rvfcHandle: number | null = null;
let fpsHandle: number | null = null;
let busy = false;
let lastSent = 0;
let statusTimer: ReturnType<typeof setInterval> | null = null;
/** Bumped by every start and stop. */
let pumpGen = 0;
/** Set once direct frames stalled in this session: later starts go straight to the fallback. */
let forceBitmap = false;
let trackerRestarts = 0;
let watchFrames = -1;
let watchSince = 0;
let lastLoggedErrorAt = 0;
let prevResultAt = 0;
let gaps: Array<{ t: number; gap: number }> = [];
const videoRate = new RateMeter();

function onResult(r: TrackerFrameResult): void {
  const now = performance.now();
  if (prevResultAt) gaps.push({ t: now, gap: now - prevResultAt });
  prevResultAt = now;
  while (gaps.length && now - gaps[0]!.t > 1000) gaps.shift();
  latestFrame.value = r;
  latestFrameAt = now;
  recordTrackerResult(r);
}

function cameraHealthy(): boolean {
  const t = currentTrack();
  return cameraState.value === 'live' && !snapping.value && t?.readyState === 'live' && !t.muted;
}

function startVideoFpsMeter(v: HTMLVideoElement, gen: number): void {
  const vv = rvfc(v);
  if (!vv.requestVideoFrameCallback) return;
  const loop = () => {
    if (gen !== pumpGen) return;
    videoRate.tick();
    hud.videoFps.value = videoRate.rate();
    fpsHandle = vv.requestVideoFrameCallback!(loop);
  };
  fpsHandle = vv.requestVideoFrameCallback(loop);
}

function startStatusPolling(gen: number): void {
  if (statusTimer) clearInterval(statusTimer);
  watchFrames = -1;
  watchSince = performance.now();
  statusTimer = setInterval(() => {
    const tr = peekTracker();
    if (!tr) return;
    void tr.api
      .status()
      .then((st) => {
        if (gen === pumpGen) onStatus(st);
      })
      .catch(() => {
        /* worker busy or gone */
      });
  }, 1000);
}

function onStatus(st: TrackerStatus): void {
  const now = performance.now();
  hud.trackerMemory.value = st.memory;
  hud.trackerSkipped.value = st.framesSkipped;
  const b = st.bigFrames;
  hud.bigFrames.value = b ? `${b.path === 'direct' ? 'full copy' : 'GPU shrink'} (full copy ${Math.round(b.directMs ?? 0)} ms, GPU ${Math.round(b.gpuMs ?? 0)} ms)` : '';

  // Errors: log each one once; show it on the HUD only while it is recent.
  const err = st.lastError;
  if (err && err.at !== lastLoggedErrorAt) {
    lastLoggedErrorAt = err.at;
    logWarn('tracker', err.message);
  }
  hud.lastError.value = err && Date.now() - err.at < ERROR_SHOW_MS ? err.message : null;

  // Smoothness: the longest pause between two results in the last second (or the current pause).
  while (gaps.length && now - gaps[0]!.t > 1000) gaps.shift();
  const current = latestFrameAt ? now - latestFrameAt : 0;
  hud.resultGapMs.value = Math.max(current, ...gaps.map((g) => g.gap), 0);

  if (st.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    void recoverTracker(`${st.consecutiveErrors} errors in a row`);
    return;
  }

  // Direct path watchdog: frames must keep arriving while the camera itself is fine.
  if (pumpMode.value === 'mstp') {
    if (st.framesReceived !== watchFrames || !cameraHealthy()) {
      watchFrames = st.framesReceived;
      watchSince = now;
    } else if (now - watchSince > STALL_MS || !st.running) {
      fallBackToBitmap(st.running ? `no frames for ${Math.round((now - watchSince) / 1000)} s` : 'the frame reader stopped');
    }
  }
}

function fallBackToBitmap(reason: string): void {
  const v = video;
  logWarn('pump', `Direct frames stopped (${reason}); switching to copied frames`);
  forceBitmap = true;
  if (v) void startPump(v);
}

async function recoverTracker(reason: string): Promise<void> {
  const v = video;
  stopPump();
  if (trackerRestarts >= MAX_TRACKER_RESTARTS) {
    pumpError.value = 'Live tracking keeps failing. Close Puzzle Lens and open it again. If it keeps happening, please send a report (Home › Send report).';
    logWarn('pump', `Tracker failed again (${reason}); giving up after ${trackerRestarts} restarts`);
    return;
  }
  trackerRestarts++;
  restartTracker(reason);
  if (v) await startPump(v);
}

/**
 * Starts sending frames from the running camera to the tracker. Safe to call again at any time.
 * `fullSizeClone`: don't shrink the tracker's copy of the camera (default: what the Photo test chose).
 */
export async function startPump(v: HTMLVideoElement, opts: { fullSizeClone?: boolean } = {}): Promise<void> {
  const fullSize = opts.fullSizeClone ?? wantsFullSizeTracking(settings.snapMethod.value);
  stopPump();
  const gen = ++pumpGen;
  video = v;
  pumpError.value = null;
  const t = currentTrack();
  if (!t) return;
  const { api, ready } = trackerWorker();
  const info = await ready;
  if (gen !== pumpGen) return;
  if (!info?.ok) {
    hud.lastError.value = info?.error ?? 'Tracker worker could not start';
    pumpError.value = 'The image engine could not start. Tap "Try again". If it keeps happening, close Puzzle Lens, open it again, and send a report.';
    return;
  }
  await api.setRate(settings.trackingFps.value);
  if (gen !== pumpGen) return;

  if (info.capabilities.mediaStreamTrackProcessor && !forceBitmap) {
    let clone: MediaStreamTrack | null = null;
    try {
      clone = t.clone();
      // The tracker only needs ~960 px, but on iPhone a shrunk copy also shrinks (or breaks)
      // photos, so when the Photo test says so the copy stays full size and the worker shrinks it.
      if (!fullSize) {
        try {
          await clone.applyConstraints({ width: { ideal: FALLBACK_WIDTH } });
        } catch {
          /* keep full size; the worker shrinks it on the GPU */
        }
      }
      if (gen !== pumpGen) {
        clone.stop();
        return;
      }
      // Once transferred, the worker owns the clone (and stops it itself if it can't use it).
      // If the transfer never happened (e.g. the track can't be sent), it is still ours: the
      // catch below stops it. Stopping an already-transferred track here is harmless.
      const res = await api.attachTrack(Comlink.transfer(clone, [clone as unknown as Transferable]), Comlink.proxy(onResult));
      if (gen !== pumpGen) {
        void api.detach().catch(() => {});
        return;
      }
      if (res.ok) {
        pumpMode.value = 'mstp';
        startVideoFpsMeter(v, gen);
        startStatusPolling(gen);
        logInfo('pump', `Frames go straight to the tracker worker${fullSize ? ' (full-size copy)' : ''}`);
        return;
      }
      clone.stop();
      logWarn('pump', `Direct frames refused: ${res.error}`);
    } catch (err) {
      clone?.stop();
      logWarn('pump', 'Direct frames not possible; using copied frames', err);
    }
    if (gen !== pumpGen) return;
  }
  pumpMode.value = 'bitmap';
  startVideoFpsMeter(v, gen);
  startStatusPolling(gen);
  startBitmapLoop(v, gen);
}

function startBitmapLoop(v: HTMLVideoElement, gen: number): void {
  const vv = rvfc(v);
  const schedule = () => {
    if (vv.requestVideoFrameCallback) rvfcHandle = vv.requestVideoFrameCallback(tick);
    else rvfcHandle = requestAnimationFrame(() => tick(performance.now()));
  };
  const tick = async (now: number) => {
    if (gen !== pumpGen || pumpMode.value !== 'bitmap') return;
    schedule();
    const minGap = 1000 / settings.trackingFps.value - 2;
    if (busy || now - lastSent < minGap || !v.videoWidth) return;
    busy = true;
    lastSent = now;
    try {
      const h = Math.round((FALLBACK_WIDTH * v.videoHeight) / v.videoWidth);
      const bmp = await createImageBitmap(v, { resizeWidth: FALLBACK_WIDTH, resizeHeight: h, resizeQuality: 'low' });
      if (gen !== pumpGen) {
        bmp.close();
        return;
      }
      const r = await trackerWorker().api.processBitmap(Comlink.transfer(bmp, [bmp]), Math.round(now * 1000));
      if (r && gen === pumpGen) onResult(r);
    } catch {
      /* skip this frame */
    } finally {
      busy = false;
    }
  };
  schedule();
}

/** Stops feeding frames. Never throws, and always leaves the pump fully off. */
export function stopPump(): void {
  pumpGen++;
  const wasDirect = pumpMode.value === 'mstp';
  const v = video;
  try {
    if (v) {
      const vv = rvfc(v);
      // Called as methods (not detached function references): WebKit throws without the right `this`.
      if (rvfcHandle !== null) {
        if (vv.cancelVideoFrameCallback) vv.cancelVideoFrameCallback(rvfcHandle);
        else cancelAnimationFrame(rvfcHandle);
      }
      if (fpsHandle !== null && vv.cancelVideoFrameCallback) vv.cancelVideoFrameCallback(fpsHandle);
    }
  } catch (err) {
    logWarn('pump', 'Could not cancel a frame callback', err);
  } finally {
    rvfcHandle = fpsHandle = null;
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = null;
    pumpMode.value = 'off';
    busy = false;
    prevResultAt = 0;
    gaps = [];
  }
  if (wasDirect) void peekTracker()?.api.detach().catch(() => {});
}

/**
 * Stops feeding frames AND waits until the tracker's copy of the camera is really closed. On iPhone
 * a still-open copy makes photos come out at its small size (owner's phone, 2026-11-06), so a
 * photo with tracking paused must wait for this.
 */
export async function stopPumpAndWait(): Promise<void> {
  const wasDirect = pumpMode.value === 'mstp';
  stopPump();
  const tr = peekTracker();
  if (wasDirect && tr) {
    try {
      await Promise.race([tr.api.detach(), new Promise((r) => setTimeout(r, 3000))]);
    } catch {
      /* worker gone */
    }
  }
}

/** Longest gap in frames reaching the tracker between two moments (ms since epoch). */
export async function trackerGap(startAbs: number, endAbs: number): Promise<number | null> {
  const tr = peekTracker();
  if (pumpMode.value === 'off' || !tr) return null;
  try {
    return await tr.api.maxFrameGap(startAbs, endAbs);
  } catch {
    return null;
  }
}

/** Polls the reader worker's memory for the HUD (when it is running). */
export async function refreshReaderMemory(): Promise<void> {
  const r = peekReader();
  if (!r) return;
  try {
    hud.readerMemory.value = await r.api.memory();
  } catch {
    /* ignore */
  }
}
