/**
 * Automatic Device checks ("Run checks"; no camera needed). Main thread. Every check is wrapped
 * so one failure becomes an "error" row and never stops the rest.
 */
import { cameraPermissionState, displayMode } from '../app/env';
import { readerInfo, readerWorker, restartReader, trackerInfo, trackerWorker } from '../app/workers';
import { db } from '../db/db';
import { imageCaptureCtor } from '../types/media';
import { makeEntry } from './catalog';
import { benchSummary, formatBytes, formatMs, gpuEntries, NORMAL_NOTE, noiseVerdict, parseIosVersion, parseSafariVersion, permissionHistoryEntry, permissionWord } from './format';
import { probeWebGpu } from './gpuTest';
import { compareNoisePattern, drawNoisePattern, NOISE_H, NOISE_W } from './noise';
import { startProbeWorker } from './probeClient';
import type { CheckEntry, DeviceEnvironment } from './types';
import { errorMessage, withTimeout } from './util';
import { detectWasmFeatures } from './wasmFeatures';
import type { GpuProbeResult, NoiseResult, ProbeWorkerCaps } from '../shared/probeApi';
import type { WorkerInitInfo } from '../shared/types';

/** Reader memory above this triggers a restart (PLAN §8), as after a Snap. */
const READER_RESTART_BYTES = 384 * 1024 * 1024;

export interface RunHooks {
  onCheck(e: CheckEntry): void;
  onProgress(message: string): void;
  isAborted(): boolean;
}

export function collectEnvironment(): DeviceEnvironment {
  const nav = navigator as Navigator & { standalone?: boolean };
  const ua = nav.userAgent ?? '';
  const scr = typeof screen !== 'undefined' ? screen : null;
  return {
    userAgent: ua,
    platform: nav.platform ?? null,
    vendor: nav.vendor ?? null,
    safariVersion: parseSafariVersion(ua),
    iosVersionInUA: parseIosVersion(ua),
    language: nav.language ?? null,
    screen: {
      width: scr?.width ?? 0,
      height: scr?.height ?? 0,
      availWidth: scr?.availWidth ?? 0,
      availHeight: scr?.availHeight ?? 0,
      orientation: scr?.orientation?.type ?? null,
    },
    viewport: { width: innerWidth, height: innerHeight },
    devicePixelRatio: devicePixelRatio ?? 1,
    hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    maxTouchPoints: typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : null,
    secureContext: isSecureContext,
    crossOriginIsolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false,
    standaloneFlag: typeof nav.standalone === 'boolean' ? nav.standalone : null,
  };
}

/** Runs `fn`; if it throws, records an error row for `id` instead. */
async function guard(h: RunHooks, id: string, fn: () => Promise<CheckEntry | CheckEntry[]> | CheckEntry | CheckEntry[]): Promise<void> {
  if (h.isAborted()) return;
  try {
    const r = await fn();
    for (const e of Array.isArray(r) ? r : [r]) h.onCheck(e);
  } catch (err) {
    h.onCheck(makeEntry(id, 'error', errorMessage(err)));
  }
}

function yesNo(b: boolean): string {
  return b ? '✓' : '✗';
}

/* ---------- individual checks ---------- */

function basics(env: DeviceEnvironment): CheckEntry[] {
  const mode = displayMode();
  return [
    makeEntry('secure-context', env.secureContext ? 'yes' : 'no', env.secureContext ? 'Yes' : 'No — the camera needs https', { isSecureContext: env.secureContext, crossOriginIsolated: env.crossOriginIsolated, protocol: location.protocol }),
    // The check is meant to be run in a Safari tab too, so being in one is expected, not a problem.
    mode === 'standalone'
      ? makeEntry('running-as', 'yes', 'Home Screen app', { displayMode: mode, standaloneFlag: env.standaloneFlag })
      : makeEntry('running-as', 'info', 'Safari tab (normal for this check — nothing to do)', { displayMode: mode, standaloneFlag: env.standaloneFlag, note: NORMAL_NOTE }),
    env.safariVersion
      ? makeEntry('browser-version', 'yes', env.safariVersion, { userAgent: env.userAgent, iosVersionInUA: env.iosVersionInUA })
      : mode === 'standalone'
        ? makeEntry('browser-version', 'info', 'Not shown in Home Screen apps (normal)', { userAgent: env.userAgent, iosVersionInUA: env.iosVersionInUA, note: NORMAL_NOTE })
        : makeEntry('browser-version', 'skipped', 'Unknown', { userAgent: env.userAgent, iosVersionInUA: env.iosVersionInUA }),
  ];
}

async function cameraBasics(): Promise<CheckEntry[]> {
  const out: CheckEntry[] = [];
  const gum = typeof navigator.mediaDevices?.getUserMedia === 'function';
  out.push(makeEntry('getusermedia', gum ? 'yes' : 'no', gum ? 'Available' : 'Not available (needs Safari over https)'));
  const state = await cameraPermissionState();
  // "Will ask" is the normal state before the camera has been used (the history row below tracks re-asking).
  const permStatus = state === 'granted' ? 'yes' : state === 'denied' ? 'no' : state === 'prompt' ? 'info' : 'skipped';
  const permValue = state === 'prompt' ? 'Will ask (normal before the camera is first used)' : permissionWord(state);
  out.push(makeEntry('camera-permission', permStatus, permValue, state === 'prompt' ? { state, note: NORMAL_NOTE } : { state }));
  const launches = await db().launches.toArray();
  out.push(permissionHistoryEntry(launches));
  const mainVf = typeof (globalThis as { VideoFrame?: unknown }).VideoFrame !== 'undefined';
  out.push(makeEntry('videoframe', mainVf ? 'yes' : 'no', mainVf ? 'Available' : 'Not available', { mainThread: mainVf }));
  const rvfc = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  out.push(makeEntry('rvfc', rvfc ? 'yes' : 'no', rvfc ? 'Available' : 'Not available'));
  return out;
}

function imageCaptureCheck(): CheckEntry {
  const Ctor = imageCaptureCtor();
  if (!Ctor) return makeEntry('imagecapture', 'no', 'Not available (photos use the iPhone camera screen instead)');
  const proto = (Ctor as unknown as { prototype: Record<string, unknown> }).prototype ?? {};
  const has = (m: string) => typeof proto[m] === 'function';
  const methods = { takePhoto: has('takePhoto'), getPhotoCapabilities: has('getPhotoCapabilities'), getPhotoSettings: has('getPhotoSettings'), grabFrame: has('grabFrame') };
  const value = `takePhoto ${yesNo(methods.takePhoto)} · photo sizes ${yesNo(methods.getPhotoCapabilities)} · grabFrame ${yesNo(methods.grabFrame)}`;
  return makeEntry('imagecapture', methods.takePhoto ? 'yes' : 'partial', value, methods);
}

function wasmChecks(worker: ProbeWorkerCaps | null): CheckEntry[] {
  const w = detectWasmFeatures();
  const details = { main: w, worker: worker?.wasm ?? null };
  return [
    makeEntry('wasm-simd', w.simd ? 'yes' : 'no', w.simd ? 'Yes' : 'No (the image engine needs it)', details),
    makeEntry('wasm-exceptions', w.exceptions ? 'yes' : 'no', w.exceptions ? `Yes${w.exnref ? ' (old and new style)' : ''}` : 'No (the image engine needs it)', details),
    w.jspi
      ? makeEntry('wasm-jspi', 'yes', 'Yes', details)
      : makeEntry('wasm-jspi', 'info', 'No (only matters for AI models later — nothing to do)', { ...details, note: NORMAL_NOTE }),
  ];
}

function noiseEntry(id: string, r: NoiseResult): CheckEntry {
  const v = noiseVerdict(r.comparison, r.error);
  return makeEntry(id, v.status, v.value, r);
}

function mainCanvasNoise(): CheckEntry {
  const t0 = performance.now();
  const canvas = document.createElement('canvas');
  canvas.width = NOISE_W;
  canvas.height = NOISE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return makeEntry('canvas-noise-main', 'error', 'No 2D drawing available');
  drawNoisePattern(ctx);
  const img = ctx.getImageData(0, 0, NOISE_W, NOISE_H);
  const comparison = compareNoisePattern(img.data, NOISE_W, NOISE_H, NOISE_W * 4, 'RGBA');
  canvas.width = canvas.height = 0;
  return noiseEntry('canvas-noise-main', { method: 'canvas-main', comparison, ms: performance.now() - t0 });
}

async function storageChecks(): Promise<CheckEntry[]> {
  const out: CheckEntry[] = [];
  const sm = navigator.storage;

  await (async () => {
    if (!sm?.estimate) return out.push(makeEntry('storage-space', 'no', 'Not reported'));
    const est = await withTimeout(sm.estimate(), 5000, 'Reading storage space');
    out.push(makeEntry('storage-space', 'yes', `Using ${formatBytes(est.usage)} of ${formatBytes(est.quota)}`, est));
  })().catch((err: unknown) => out.push(makeEntry('storage-space', 'error', errorMessage(err))));

  await (async () => {
    if (!sm?.persisted) return out.push(makeEntry('storage-persist', 'no', 'Not supported'));
    const before = await withTimeout(sm.persisted(), 5000, 'Reading storage protection');
    let after: boolean | null = before;
    if (!before && sm.persist) after = await withTimeout(sm.persist(), 5000, 'Asking for storage protection');
    const details = { persistedBefore: before, persistResult: before ? null : after };
    if (after) out.push(makeEntry('storage-persist', 'yes', 'Yes', details));
    // Safari tabs are rarely protected; that's expected (the Home Screen app is what holds puzzles).
    else if (displayMode() === 'browser') out.push(makeEntry('storage-persist', 'info', 'Not yet (normal in a Safari tab — nothing to do)', { ...details, note: NORMAL_NOTE }));
    else out.push(makeEntry('storage-persist', 'partial', 'Not yet (iOS may protect it after you use the app more)', details));
  })().catch((err: unknown) => out.push(makeEntry('storage-persist', 'error', errorMessage(err))));

  await (async () => {
    if (typeof sm?.getDirectory !== 'function') return out.push(makeEntry('opfs', 'no', 'Not available'));
    const dir = await withTimeout(sm.getDirectory(), 5000, 'Opening private file storage');
    out.push(makeEntry('opfs', 'yes', 'Available', { kind: dir.kind }));
  })().catch((err: unknown) => out.push(makeEntry('opfs', 'error', errorMessage(err))));

  await (async () => {
    if (typeof indexedDB === 'undefined') return out.push(makeEntry('indexeddb', 'no', 'Not available'));
    const saved = await withTimeout(db().deviceChecks.count(), 5000, 'Opening the database');
    out.push(makeEntry('indexeddb', 'yes', 'Working', { savedDeviceChecks: saved }));
  })().catch((err: unknown) => out.push(makeEntry('indexeddb', 'error', errorMessage(err))));

  await (async () => {
    const sw = navigator.serviceWorker;
    if (!sw) return out.push(makeEntry('service-worker', 'no', 'Not supported here'));
    const reg = await withTimeout(sw.getRegistration(), 5000, 'Checking offline support').catch(() => undefined);
    const details = { controller: Boolean(sw.controller), registered: Boolean(reg), scope: reg?.scope ?? null, active: reg?.active?.state ?? null, waiting: Boolean(reg?.waiting) };
    if (sw.controller) out.push(makeEntry('service-worker', 'yes', 'Ready (works without internet)', details));
    else if (reg) out.push(makeEntry('service-worker', 'partial', 'Installed; active after the app is reopened', details));
    else out.push(makeEntry('service-worker', 'no', 'Not installed yet (normal in a test build)', details));
  })().catch((err: unknown) => out.push(makeEntry('service-worker', 'error', errorMessage(err))));

  return out;
}

async function otherChecks(): Promise<CheckEntry[]> {
  const out: CheckEntry[] = [];

  await (async () => {
    if (!('wakeLock' in navigator)) return out.push(makeEntry('wake-lock', 'no', 'Not available'));
    if (document.visibilityState !== 'visible') return out.push(makeEntry('wake-lock', 'skipped', 'App was in the background'));
    const sentinel = await withTimeout(navigator.wakeLock.request('screen'), 5000, 'Keeping the screen awake');
    const held = !sentinel.released;
    await sentinel.release();
    out.push(makeEntry('wake-lock', held ? 'yes' : 'partial', held ? 'Works' : 'Released straight away', { held, releasedAfter: sentinel.released }));
  })().catch((err: unknown) => {
    // NotAllowedError = refused by the browser's rules (e.g. battery saver), not a broken test.
    const refused = (err as { name?: string })?.name === 'NotAllowedError';
    out.push(makeEntry('wake-lock', refused ? 'partial' : 'error', refused ? `Refused right now (${errorMessage(err)})` : errorMessage(err)));
  });

  await (async () => {
    if (typeof navigator.canShare !== 'function') return out.push(makeEntry('web-share-files', 'no', typeof navigator.share === 'function' ? 'Sharing works, but not files' : 'Not available'));
    const tryType = (name: string, type: string) => {
      try {
        return navigator.canShare({ files: [new File(['x'], name, { type })] });
      } catch {
        return false;
      }
    };
    const types = { zip: tryType('report.zip', 'application/zip'), jpeg: tryType('photo.jpg', 'image/jpeg'), text: tryType('note.txt', 'text/plain') };
    const all = types.zip && types.jpeg && types.text;
    const any = types.zip || types.jpeg || types.text;
    const value = all ? 'Works (reports and photos can be shared)' : any ? `Only some files (zip ${yesNo(types.zip)} · photo ${yesNo(types.jpeg)} · text ${yesNo(types.text)})` : 'Files cannot be shared';
    out.push(makeEntry('web-share-files', all ? 'yes' : any ? 'partial' : 'no', value, types));
  })().catch((err: unknown) => out.push(makeEntry('web-share-files', 'error', errorMessage(err))));

  await (async () => {
    const DOE = (globalThis as { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent;
    if (!DOE) return out.push(makeEntry('orientation-permission', 'no', 'Not available'));
    const ask = typeof DOE.requestPermission === 'function';
    out.push(makeEntry('orientation-permission', 'yes', ask ? 'Available (asks when the tilt guide is first used)' : 'Available', { requestPermission: ask }));
  })().catch((err: unknown) => out.push(makeEntry('orientation-permission', 'error', errorMessage(err))));

  return out;
}

function workerCapEntries(caps: ProbeWorkerCaps, startMs: number): CheckEntry[] {
  const mainMstp = typeof (globalThis as { MediaStreamTrackProcessor?: unknown }).MediaStreamTrackProcessor !== 'undefined';
  const others = { tracker: trackerInfo.value?.capabilities ?? null, reader: readerInfo.value?.capabilities ?? null };
  const out: CheckEntry[] = [];
  out.push(makeEntry('background-workers', 'yes', `Started in ${formatMs(startMs)}`, { startMs, hardwareConcurrency: caps.hardwareConcurrency }));
  out.push(
    makeEntry('mstp-worker', caps.mediaStreamTrackProcessor ? 'yes' : 'no', caps.mediaStreamTrackProcessor ? 'Yes (the fast way)' : 'No (uses the slower way)', {
      worker: caps.mediaStreamTrackProcessor,
      mainThread: mainMstp,
      ...others,
    }),
  );
  const c2d = caps.offscreenCanvas2d;
  const all = c2d && caps.offscreenCanvasWebgl && caps.offscreenCanvasWebgl2;
  out.push(
    makeEntry('offscreen-canvas', all ? 'yes' : c2d ? 'partial' : 'no', `2D ${yesNo(c2d)} · WebGL ${yesNo(caps.offscreenCanvasWebgl)} · WebGL2 ${yesNo(caps.offscreenCanvasWebgl2)}`, {
      offscreenCanvas2d: c2d,
      webgl: caps.offscreenCanvasWebgl,
      webgl2: caps.offscreenCanvasWebgl2,
      convertToBlob: caps.offscreenConvertToBlob,
    }),
  );
  const bmpOk = caps.createImageBitmapWorks && caps.createImageBitmapFromBlob;
  out.push(
    makeEntry('image-bitmap-worker', bmpOk ? 'yes' : caps.createImageBitmapWorks ? 'partial' : 'no', bmpOk ? 'Works (including photos)' : caps.createImageBitmapWorks ? "Works, but couldn't decode a JPEG" : 'Not working', {
      createImageBitmap: caps.createImageBitmapWorks,
      fromJpegBlob: caps.createImageBitmapFromBlob,
      videoFrameCopyTo: caps.videoFrameCopyTo,
      errors: caps.errors,
    }),
  );
  return out;
}

async function openCvChecks(h: RunHooks): Promise<CheckEntry[]> {
  const out: CheckEntry[] = [];
  h.onProgress('Loading the image engine (OpenCV)…');
  const reader = readerWorker();
  const tracker = trackerWorker();
  const [rInfo, tInfo] = await Promise.all([
    withTimeout(reader.ready, 90_000, 'Loading the image engine').catch((err: unknown) => ({ ok: false, cvLoadMs: 0, error: errorMessage(err) }) as Partial<WorkerInitInfo>),
    withTimeout(tracker.ready, 90_000, 'Loading the live image engine').catch((err: unknown) => ({ ok: false, cvLoadMs: 0, error: errorMessage(err) }) as Partial<WorkerInitInfo>),
  ]);
  const load = { reader: rInfo ? { ok: rInfo.ok, cvLoadMs: rInfo.cvLoadMs, error: rInfo.error } : null, tracker: tInfo ? { ok: tInfo.ok, cvLoadMs: tInfo.cvLoadMs, error: tInfo.error } : null };
  if (!rInfo?.ok) {
    out.push(makeEntry('opencv-load', 'error', rInfo?.error ?? 'The photo helper did not start', load));
    out.push(makeEntry('opencv-bench', 'skipped', 'Image engine not loaded'));
    return out;
  }
  const value = `photo helper ${formatMs(rInfo.cvLoadMs)} · live helper ${tInfo?.ok ? formatMs(tInfo.cvLoadMs) : 'failed'}`;
  out.push(makeEntry('opencv-load', tInfo?.ok ? 'yes' : 'partial', value, load));
  if (h.isAborted()) return out;
  h.onProgress('Measuring the image engine speed…');
  try {
    const bench = await withTimeout(reader.api.bench(), 120_000, 'The speed test');
    const s = benchSummary(bench);
    out.push(makeEntry('opencv-bench', s.status, s.value, bench));
    const mem = await reader.api.memory().catch(() => null);
    if (mem && mem.wasmBytes > READER_RESTART_BYTES) restartReader();
  } catch (err) {
    out.push(makeEntry('opencv-bench', 'error', errorMessage(err)));
  }
  return out;
}

/* ---------- the run ---------- */

/** Runs every automatic check, reporting each row as soon as it's known. */
export async function runAutomaticChecks(h: RunHooks): Promise<void> {
  const env = collectEnvironment();
  h.onProgress('Checking the basics…');
  await guard(h, 'secure-context', () => basics(env));
  await guard(h, 'getusermedia', cameraBasics);
  await guard(h, 'imagecapture', imageCaptureCheck);
  await guard(h, 'canvas-noise-main', mainCanvasNoise);

  h.onProgress('Checking storage…');
  await guard(h, 'storage-space', storageChecks);
  await guard(h, 'wake-lock', otherChecks);

  h.onProgress('Checking the background helpers…');
  const probe = startProbeWorker();
  let caps: ProbeWorkerCaps | null = null;
  try {
    const t0 = performance.now();
    try {
      caps = await probe.call((api) => api.capabilities(), 20_000, 'Starting a background helper');
      const startMs = performance.now() - t0;
      for (const e of workerCapEntries(caps, startMs)) h.onCheck(e);
    } catch (err) {
      const msg = errorMessage(err);
      h.onCheck(makeEntry('background-workers', 'error', msg));
      for (const id of ['mstp-worker', 'offscreen-canvas', 'image-bitmap-worker']) h.onCheck(makeEntry(id, 'error', `Background helper failed: ${msg}`));
    }
    await guard(h, 'wasm-simd', () => wasmChecks(caps));

    await guard(h, 'canvas-noise-worker', async () => {
      if (!caps) throw new Error('Background helper not available');
      const results = await probe.call((api) => api.canvasNoise(), 15_000, 'Reading pixels in a helper');
      const off = results.find((r) => r.method === 'offscreen-worker');
      const vf = results.find((r) => r.method === 'videoframe-worker');
      return [
        off ? noiseEntry('canvas-noise-worker', off) : makeEntry('canvas-noise-worker', 'error', 'No result'),
        vf ? noiseEntry('videoframe-readback', vf) : makeEntry('videoframe-readback', 'error', 'No result'),
      ];
    });

    if (h.isAborted()) return;
    h.onProgress('Testing the graphics chip…');
    await guard(h, 'webgpu-adapter', async () => {
      const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
      const main = await probeWebGpu(gpu, 'main');
      let worker: GpuProbeResult | null = null;
      let workerError: string | undefined;
      if (caps) {
        try {
          worker = await probe.call((api) => api.webgpu(), 40_000, 'The graphics test in a helper');
        } catch (err) {
          workerError = errorMessage(err);
        }
      } else workerError = 'Background helper not available';
      return gpuEntries(main, worker, workerError);
    });
  } finally {
    probe.close();
  }

  if (h.isAborted()) return;
  await guard(h, 'opencv-load', () => openCvChecks(h));
}

