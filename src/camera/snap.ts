/**
 * Snap = a full-resolution still photo, then a tile-by-tile check of it in the reader worker.
 * The latest Snap is kept (in the database) so it can go into a report.
 */
import { signal } from '@preact/signals';
import { hasImageCapture, setExternalCapture, takePhoto, cameraState, type SnapResult } from './camera';
import { trackerGap, refreshReaderMemory } from './framePump';
import { peekReader, readerWorker, restartReader } from '../app/workers';
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
  return hasImageCapture() && cameraState.value === 'live' && takePhotoFailures < MAX_TAKEPHOTO_FAILURES;
}

export async function snapWithCamera(): Promise<SnapRecord> {
  snapBusy.value = true;
  try {
    let result: SnapResult;
    try {
      result = await takePhoto('current');
    } catch (err) {
      takePhotoFailures++;
      logError('snap', `Photo failed (${takePhotoFailures} so far)`, err);
      const why = String((err as Error)?.message ?? err);
      const rec: SnapRecord = {
        snap: emptySnap('takePhoto'),
        stats: null,
        previewUrl: null,
        error: `The photo didn't come back from the camera. (${why})`,
        cameraFailed: true,
      };
      lastSnap.value = rec;
      return rec;
    }
    takePhotoFailures = 0;
    result.workerGapMs = await trackerGap(result.startAbs, result.endAbs);
    return await processSnap(result);
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

function emptySnap(method: SnapResult['method']): SnapRecord['snap'] {
  return { method, requested: null, ms: 0, mutedMs: 0, workerGapMs: null, startAbs: 0, endAbs: 0, bytes: 0, type: '' };
}
