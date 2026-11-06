/**
 * Snap = a full-resolution still picture, then a tile-by-tile check of it in the reader worker.
 * The latest Snap is kept (in the database) so it can go into a report.
 *
 * How the picture is taken follows the Device check "Photo test" (settings.snapMethod). Without a
 * result: the camera's photo pipeline (takePhoto) first, then the full-size live picture
 * (grabFrame: 12 MP in the 4:3 format), then the iPhone camera screen is offered.
 */
import { signal } from '@preact/signals';
import { cameraStream, currentTrack, grabFullFrame, hasImageCapture, photoInfo, setExternalCapture, startCamera, takePhoto, cameraState, type SnapResult } from './camera';
import { trackerGap, refreshReaderMemory, startPump, stopPumpAndWait } from './framePump';
import { JPEG_HEADER_BYTES, parseJpegHeader } from '../device/jpeg';
import { parseSnapMethod, photoSizeFor, type SnapMethod } from './snapMethod';
import { settings } from '../app/settings';
import { Comlink, peekReader, readerWorker, restartReader } from '../app/workers';
import { trackSettings, type PhotoCapabilitiesLike, type PhotoSettingsLike } from '../types/media';
import { db } from '../db/db';
import { logError, logInfo, logWarn } from '../log/logger';
import type { PhotoStats } from '../shared/types';

export interface SnapRecord {
  snap: Omit<SnapResult, 'blob'> & { bytes: number; type: string };
  stats: PhotoStats | null;
  previewUrl: string | null;
  /** The photo couldn't be taken or checked (shown in red). */
  error: string | null;
  /** The photo was checked but couldn't be kept for reports (shown as a gentle note). */
  saveWarning?: string | null;
  /** True when the app's own photo (ImageCapture) failed: offer the iPhone camera screen instead. */
  cameraFailed?: boolean;
}

export const lastSnap = signal<SnapRecord | null>(null);
export const snapBusy = signal(false);

/** Reader memory above this triggers a restart after the job (PLAN §8). */
const READER_RESTART_BYTES = 384 * 1024 * 1024;
/** After this many failed in-app photos, Snap uses the iPhone camera screen instead (RESEARCH §3). */
const MAX_TAKEPHOTO_FAILURES = 2;
let takePhotoFailures = 0;

/** Time limits for the photo check, so a stuck helper can never leave Snap greyed out. */
const READY_TIMEOUT_MS = 90_000;
const ANALYSE_TIMEOUT_MS = 60_000;
const PREVIEW_TIMEOUT_MS = 30_000;
const MEMORY_TIMEOUT_MS = 2_000;

class Timeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Timeout(`${what} took longer than ${Math.round(ms / 1000)} seconds`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function canSnapWithCamera(): boolean {
  if (parseSnapMethod(settings.snapMethod.value)?.kind === 'file') return false;
  return hasImageCapture() && cameraState.value === 'live' && takePhotoFailures < MAX_TAKEPHOTO_FAILURES;
}

/** Pixel count of a JPEG from its header (no decode), or null. */
async function jpegPixels(blob: Blob): Promise<{ w: number; h: number } | null> {
  try {
    const info = parseJpegHeader(new Uint8Array(await blob.slice(0, JPEG_HEADER_BYTES).arrayBuffer()));
    return info ? { w: info.displayWidth, h: info.displayHeight } : null;
  } catch {
    return null;
  }
}

/** A photo much smaller than the live camera picture is a failed photo (the tracker's small copy leaked into it). */
async function assertFullSize(r: SnapResult): Promise<void> {
  const t = currentTrack();
  const s = t ? trackSettings(t) : {};
  const live = (s.width ?? 0) * (s.height ?? 0);
  const got = await jpegPixels(r.blob);
  if (live && got && got.w * got.h < 0.5 * live) throw new SmallPhoto(`The photo came out small (${got.w}×${got.h})`);
}

class SmallPhoto extends Error {}

/**
 * Takes a photo the way `method` says (null = the camera contract's default). With `checkSize`
 * (default) a photo that comes out much smaller than the live picture counts as a failure, so
 * Snap falls back to the full-size live picture.
 */
export async function takePhotoWith(
  method: Extract<SnapMethod, { kind: 'takePhoto' }> | null,
  video: HTMLVideoElement | null,
  timeoutMs?: number,
  checkSize = true,
): Promise<SnapResult> {
  if (!method) {
    const r = await takePhoto('current', { timeoutMs });
    if (checkSize) await assertFullSize(r);
    return r;
  }
  let size: PhotoSettingsLike | null = null;
  if (method.size !== 'none') {
    const t = currentTrack();
    const info = method.size === 'caps-max' || method.size === 'camera-default' ? await photoInfo() : null;
    size = photoSizeFor(method.size, t ? trackSettings(t) : {}, info?.capabilities as PhotoCapabilitiesLike | null, info?.settings as PhotoSettingsLike | null);
  }
  const resume = method.pauseTracking || method.restartCamera === true;
  if (resume) {
    // Wait until the tracker's copy of the camera is closed, then give the camera a moment to go back to full size.
    await stopPumpAndWait();
    await new Promise((r) => setTimeout(r, 400));
  }
  if (method.restartCamera) {
    await startCamera();
    const t0 = performance.now();
    while (!(cameraState.value === 'live' && currentTrack()?.muted !== true) && performance.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 50));
    if (cameraState.value !== 'live') throw new Error('The camera did not come back after restarting it');
    if (video && cameraStream.value && video.srcObject !== cameraStream.value) {
      video.srcObject = cameraStream.value;
      void video.play().catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    let r = await takePhoto(size, { onClone: method.onClone, timeoutMs });
    if (checkSize) {
      try {
        await assertFullSize(r);
      } catch (err) {
        if (!(err instanceof SmallPhoto) || !resume) throw err;
        // Once more after a longer wait: the camera may still have been switching back.
        await new Promise((res) => setTimeout(res, 800));
        r = await takePhoto(size, { onClone: method.onClone, timeoutMs });
        await assertFullSize(r);
      }
    }
    return r;
  } finally {
    if (resume && video) void startPump(video);
  }
}

export async function snapWithCamera(video: HTMLVideoElement | null = null): Promise<SnapRecord> {
  snapBusy.value = true;
  try {
    const method = parseSnapMethod(settings.snapMethod.value);
    const tried: string[] = [];
    if (!method || method.kind === 'takePhoto') {
      try {
        // Without a Photo test result, don't wait long before trying the live picture instead.
        const result = await takePhotoWith(method?.kind === 'takePhoto' ? method : null, video, method ? 20_000 : 8_000);
        takePhotoFailures = 0;
        result.workerGapMs = await trackerGap(result.startAbs, result.endAbs);
        return await processSnap(result);
      } catch (err) {
        tried.push(`photo: ${String((err as Error)?.message ?? err)}`);
        logWarn('snap', 'Camera photo failed; trying the full-size live picture', err);
      }
    }
    try {
      const g = await grabFullFrame();
      const gap = await trackerGap(g.startAbs, g.endAbs);
      return await processFrameSnap(g, gap, tried);
    } catch (err) {
      tried.push(`live picture: ${String((err as Error)?.message ?? err)}`);
    }
    takePhotoFailures++;
    logError('snap', `Snap failed (${takePhotoFailures} so far): ${tried.join('; ')}`);
    const rec: SnapRecord = {
      snap: emptySnap('takePhoto'),
      stats: null,
      previewUrl: null,
      error: `The photo didn't come back from the camera. (${tried.join('; ')})`,
      cameraFailed: true,
    };
    lastSnap.value = rec;
    return rec;
  } finally {
    snapBusy.value = false;
  }
}

/** Fallback: a photo from the iPhone's own camera screen via <input type=file capture>. */
export async function snapFromFile(file: File, openedAt: number): Promise<SnapRecord> {
  setExternalCapture(false);
  snapBusy.value = true;
  try {
    const endAbs = performance.timeOrigin + performance.now();
    const result: SnapResult = { blob: file, method: 'file-input', requested: null, ms: endAbs - openedAt, mutedMs: 0, workerGapMs: null, startAbs: openedAt, endAbs };
    return await processSnap(result);
  } finally {
    snapBusy.value = false;
  }
}

export function beginExternalCapture(): number {
  setExternalCapture(true);
  return performance.timeOrigin + performance.now();
}

export function cancelExternalCapture(): void {
  setExternalCapture(false);
}

async function processSnap(result: SnapResult): Promise<SnapRecord> {
  const { blob, ...meta } = result;
  let stats: PhotoStats | null = null;
  let error: string | null = null;
  let saveWarning: string | null = null;
  let previewUrl: string | null = null;
  let preview: Blob | null = null;
  const reader = readerWorker();
  try {
    const info = await withTimeout(reader.ready, READY_TIMEOUT_MS, 'Starting the photo checker');
    if (!info?.ok) throw new Error(info?.error ?? 'The photo checker could not start');
    stats = await withTimeout(reader.api.analysePhoto(blob), ANALYSE_TIMEOUT_MS, 'Checking the photo');
    preview = await withTimeout(reader.api.preview(blob, 1024, { width: stats.width, height: stats.height }), PREVIEW_TIMEOUT_MS, 'Making the preview');
    previewUrl = URL.createObjectURL(preview);
    logInfo('snap', `Photo ${stats.width}×${stats.height}, checked in ${Math.round(stats.analyseMs)} ms`, { meta, stats });
  } catch (err) {
    const why = String((err as Error)?.message ?? err);
    error = err instanceof Timeout ? `${why}. The photo checker was restarted; please try again.` : `The photo was taken but couldn't be checked. (${why})`;
    logError('snap', 'Photo check failed', err);
    // A helper that timed out may be stuck or gone (Comlink can't tell): start a fresh one next time.
    if (err instanceof Timeout) restartReader();
  }

  // Keeping the photo for reports is a bonus: if storage refuses (Private Browsing, storage full)
  // the check above still counts.
  if (stats && preview) {
    try {
      await db().blobs.put({ id: 'last-snap', ts: Date.now(), kind: 'snap', blob, meta: { ...meta, stats } });
      await db().blobs.put({ id: 'last-snap-preview', ts: Date.now(), kind: 'snap-preview', blob: preview });
    } catch (err) {
      saveWarning = "Photo checked ✓, but it couldn't be kept for reports (Private Browsing, or the iPhone is low on storage?).";
      logWarn('snap', 'Could not keep the photo for reports', err);
    }
  }

  await refreshReaderMemory();
  const live = peekReader();
  if (live) {
    try {
      const mem = await withTimeout(live.api.memory(), MEMORY_TIMEOUT_MS, 'Reading memory');
      if (mem.wasmBytes > READER_RESTART_BYTES) restartReader();
    } catch {
      /* ignore */
    }
  }
  const old = lastSnap.value?.previewUrl;
  if (old) URL.revokeObjectURL(old);
  const rec: SnapRecord = { snap: { ...meta, bytes: blob.size, type: blob.type }, stats, previewUrl, error, saveWarning };
  lastSnap.value = rec;
  return rec;
}

/** A Snap taken as the full-size live picture: checked, previewed and kept like a photo. */
async function processFrameSnap(g: { bitmap: ImageBitmap; ms: number; startAbs: number; endAbs: number }, gap: number | null, tried: string[]): Promise<SnapRecord> {
  let stats: PhotoStats | null = null;
  let error: string | null = null;
  let saveWarning: string | null = null;
  let previewUrl: string | null = null;
  let jpeg: Blob | null = null;
  const reader = readerWorker();
  const meta: Omit<SnapResult, 'blob'> = { method: 'grabFrame', requested: null, ms: g.ms, mutedMs: 0, workerGapMs: gap, startAbs: g.startAbs, endAbs: g.endAbs };
  try {
    const info = await withTimeout(reader.ready, READY_TIMEOUT_MS, 'Starting the photo checker');
    if (!info?.ok) throw new Error(info?.error ?? 'The photo checker could not start');
    const out = await withTimeout(reader.api.analyseFrame(Comlink.transfer(g.bitmap, [g.bitmap])), ANALYSE_TIMEOUT_MS, 'Checking the picture');
    stats = out.stats;
    jpeg = out.jpeg;
    previewUrl = URL.createObjectURL(out.preview);
    logInfo('snap', `Live picture ${stats.width}×${stats.height}, checked in ${Math.round(stats.analyseMs)} ms`, { meta, stats, tried });
    try {
      await db().blobs.put({ id: 'last-snap', ts: Date.now(), kind: 'snap', blob: out.jpeg, meta: { ...meta, stats, tried } });
      await db().blobs.put({ id: 'last-snap-preview', ts: Date.now(), kind: 'snap-preview', blob: out.preview });
    } catch (err) {
      saveWarning = "Photo checked ✓, but it couldn't be kept for reports (Private Browsing, or the iPhone is low on storage?).";
      logWarn('snap', 'Could not keep the photo for reports', err);
    }
  } catch (err) {
    try {
      g.bitmap.close();
    } catch {
      /* already transferred */
    }
    const why = String((err as Error)?.message ?? err);
    error = err instanceof Timeout ? `${why}. The photo checker was restarted; please try again.` : `The picture was taken but couldn't be checked. (${why})`;
    logError('snap', 'Live picture check failed', err);
    if (err instanceof Timeout) restartReader();
  }
  await refreshReaderMemory();
  const old = lastSnap.value?.previewUrl;
  if (old) URL.revokeObjectURL(old);
  const rec: SnapRecord = { snap: { ...meta, bytes: jpeg?.size ?? 0, type: jpeg?.type ?? '' }, stats, previewUrl, error, saveWarning };
  lastSnap.value = rec;
  return rec;
}

function emptySnap(method: SnapResult['method']): SnapRecord['snap'] {
  return { method, requested: null, ms: 0, mutedMs: 0, workerGapMs: null, startAbs: 0, endAbs: 0, bytes: 0, type: '' };
}
