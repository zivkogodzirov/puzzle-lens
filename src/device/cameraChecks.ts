/**
 * Camera tests ("Start camera tests") and the file-input camera check. Main thread.
 * Measures what only the iPhone can answer (RESEARCH §19 items 1–5): real formats and frame
 * rates, lenses and controls, photo size per live format with and without an explicit size,
 * how long the camera pauses during a photo and the gap in frames reaching the tracker, 48 MP,
 * the torch, and the 2× lens test. Every step is wrapped so one failure never stops the rest.
 */
import {
  cameraDevices,
  cameraError,
  cameraInfo,
  cameraState,
  cameraStream,
  constraintsFor,
  currentTrack,
  setTorch,
  setZoom,
  startCamera,
  stopCamera,
  takePhoto,
} from '../camera/camera';
import { latestFrame, pumpMode, startPump, stopPump, trackerGap } from '../camera/framePump';
import { readerWorker, restartReader } from '../app/workers';
import { rvfc, trackSettings, type PhotoSettingsLike, type VideoFrameMeta } from '../types/media';
import { CAMERA_FORMATS, FORMAT_NAMES, makeEntry, type CameraFormat } from './catalog';
import { formatBytes, formatMs, fpsFromSamples, megapixels, NORMAL_NOTE, photoStatus, sizeText, twoXVerdict, type FpsSample } from './format';
import { JPEG_HEADER_BYTES, parseJpegHeader, type JpegInfo } from './jpeg';
import type { CheckEntry } from './types';
import type { RunHooks } from './autoChecks';
import { errorMessage, mayStopCamera, sleep, waitFor, withTimeout } from './util';
import { logWarn } from '../log/logger';

/** Photos larger than this are measured from the JPEG header only (never decoded on the main thread). */
const MAX_DECODE_PIXELS = 16_000_000;
const SETTLE_MS = 800;
const FPS_WINDOW_MS = 2000;
const READER_RESTART_BYTES = 384 * 1024 * 1024;
/** 48 MP in landscape (AVFoundation photo sizes are landscape). */
const SIZE_48MP: PhotoSettingsLike = { imageWidth: 8064, imageHeight: 6048 };

export interface CameraRunHooks extends RunHooks {
  video: HTMLVideoElement;
}

/* ---------- helpers ---------- */

/**
 * Stops the frame pump; a failure is logged, never thrown, so cleanup can always carry on to
 * stopping the camera (stopPump() itself is written not to throw; this is belt and braces).
 */
export function safeStopPump(): string | null {
  try {
    stopPump();
    return null;
  } catch (err) {
    logWarn('device', 'Stopping the frame pump failed', err);
    return errorMessage(err);
  }
}

export interface PhotoMeasure {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape' | 'square';
  decodedBy: 'createImageBitmap' | 'jpeg-header';
  decodeMs: number | null;
  header: JpegInfo | null;
  bytes: number;
  type: string;
}

/** Pixel size of a photo as displayed (EXIF orientation applied). Big photos: header only. */
export async function measurePhoto(blob: Blob): Promise<PhotoMeasure> {
  let header: JpegInfo | null = null;
  try {
    header = parseJpegHeader(new Uint8Array(await blob.slice(0, JPEG_HEADER_BYTES).arrayBuffer()));
  } catch {
    header = null;
  }
  let width = header?.displayWidth ?? 0;
  let height = header?.displayHeight ?? 0;
  let decodedBy: PhotoMeasure['decodedBy'] = 'jpeg-header';
  let decodeMs: number | null = null;
  if (!header || header.width * header.height <= MAX_DECODE_PIXELS) {
    const t0 = performance.now();
    // imageOrientation defaults to 'from-image': the size comes out the way the photo is displayed.
    const bmp = await createImageBitmap(blob);
    width = bmp.width;
    height = bmp.height;
    bmp.close();
    decodeMs = performance.now() - t0;
    decodedBy = 'createImageBitmap';
  }
  if (!width || !height) throw new Error('Could not read the photo size');
  const orientation = width > height ? 'landscape' : height > width ? 'portrait' : 'square';
  return { width, height, orientation, decodedBy, decodeMs, header, bytes: blob.size, type: blob.type || 'unknown' };
}

function idealOf(c: unknown): number | null {
  if (typeof c === 'number') return c;
  if (c && typeof c === 'object') {
    const o = c as { ideal?: unknown; exact?: unknown; max?: unknown };
    for (const v of [o.exact, o.ideal, o.max]) if (typeof v === 'number') return v;
  }
  return null;
}

function zoomNow(): number | null {
  const t = currentTrack();
  return t ? (trackSettings(t).zoom ?? null) : null;
}

/** Waits until the camera is live and not muted (after a Snap, a format switch or a zoom change). */
export function waitLive(ms: number): Promise<boolean> {
  return waitFor(() => cameraState.value === 'live' && currentTrack()?.muted !== true, ms);
}

export async function attachPreview(video: HTMLVideoElement): Promise<void> {
  const stream = cameraStream.value;
  if (!stream) throw new Error('No camera picture');
  if (video.srcObject !== stream) video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await withTimeout(video.play(), 5000, 'Starting the preview').catch(() => {});
  const ok = await waitFor(() => video.readyState >= 2 && video.videoWidth > 0, 5000);
  if (!ok) throw new Error('The camera picture did not appear');
}

/** Frames per second actually shown, measured with requestVideoFrameCallback. */
function measureFps(video: HTMLVideoElement, ms: number): Promise<{ fps: number; frames: number; spanMs: number } | null> {
  const v = rvfc(video);
  const request = v.requestVideoFrameCallback?.bind(v);
  if (!request) return Promise.resolve(null);
  return new Promise((resolve) => {
    const samples: FpsSample[] = [];
    let handle: number | null = null;
    let finished = false;
    const start = performance.now();
    const finish = () => {
      if (finished) return;
      finished = true;
      if (handle !== null) v.cancelVideoFrameCallback?.(handle);
      resolve(fpsFromSamples(samples));
    };
    const cb = (now: number, meta: VideoFrameMeta) => {
      if (finished) return;
      samples.push({ t: now, presented: meta?.presentedFrames ?? null });
      if (now - start >= ms) finish();
      else handle = request(cb);
    };
    handle = request(cb);
    setTimeout(finish, ms + 1500); // in case no frames arrive at all
  });
}

/* ---------- rows ---------- */

function lensEntries(): CheckEntry[] {
  const out: CheckEntry[] = [];
  const info = cameraInfo.value;
  const devices = cameraDevices.value;
  const labels = devices.map((d) => d.label || 'Camera');
  out.push(
    makeEntry('camera-lenses', devices.length ? 'yes' : 'partial', devices.length ? `${devices.length}: ${labels.join(', ')}` : 'None listed', {
      cameras: labels,
      inUse: info?.label ?? null,
    }),
  );
  const caps = info?.capabilities ?? {};
  const wMax = caps.width?.max;
  const hMax = caps.height?.max;
  const fr = caps.frameRate;
  const parts: string[] = [];
  if (wMax && hMax) parts.push(`up to ${wMax}×${hMax}`);
  if (fr?.max) parts.push(`${fr.min != null ? `${Math.round(fr.min)}–` : 'up to '}${Math.round(fr.max)} fps`);
  out.push(
    makeEntry('camera-capabilities', parts.length ? 'yes' : 'partial', parts.length ? parts.join(', ') : 'Not reported', {
      camera: info?.label,
      capabilities: caps,
      settings: info?.settings,
    }),
  );
  const z = caps.zoom;
  const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  out.push(z ? makeEntry('camera-zoom', 'yes', `${fmt(z.min)}× to ${fmt(z.max)}×`, z) : makeEntry('camera-zoom', 'no', 'No zoom control', null));
  const focus = Boolean(caps.focusDistance) || (caps.focusMode?.length ?? 0) > 1;
  const wb = (caps.whiteBalanceMode?.length ?? 0) > 0;
  const exposure = (caps.exposureMode?.length ?? 0) > 1;
  const count = [focus, wb, exposure].filter(Boolean).length;
  const mark = (b: boolean) => (b ? '✓' : '✗');
  const controls = `focus ${mark(focus)} · white balance ${mark(wb)} · exposure ${mark(exposure)}`;
  const controlDetails = {
    focusDistance: caps.focusDistance ?? null,
    focusMode: caps.focusMode ?? null,
    whiteBalanceMode: caps.whiteBalanceMode ?? null,
    exposureMode: caps.exposureMode ?? null,
  };
  // Safari on iPhone doesn't offer manual focus/exposure (RESEARCH §3); Puzzle Lens uses the automatic ones.
  out.push(
    count === 3
      ? makeEntry('camera-controls', 'yes', controls, controlDetails)
      : makeEntry('camera-controls', 'info', `${controls} (normal on iPhone — nothing to do)`, { ...controlDetails, note: NORMAL_NOTE }),
  );
  return out;
}

async function torchEntry(): Promise<CheckEntry> {
  const caps = cameraInfo.value?.capabilities;
  if (!caps?.torch) return makeEntry('camera-torch', 'no', 'Not on this camera');
  const t = currentTrack();
  await setTorch(true);
  await sleep(500);
  const on = t ? trackSettings(t).torch === true : false;
  await setTorch(false);
  await sleep(300);
  const off = t ? trackSettings(t).torch !== true : true;
  if (on && off) return makeEntry('camera-torch', 'yes', 'Works', { on, off });
  return makeEntry('camera-torch', 'partial', on ? "Switched on, but didn't switch off" : "Listed, but didn't switch on", { on, off });
}

function formatEntry(format: CameraFormat, requested: MediaTrackConstraints, fps: { fps: number; frames: number; spanMs: number } | null, pumpError: string | null): CheckEntry {
  const t = currentTrack();
  const s = t ? trackSettings(t) : null;
  const wantW = idealOf(requested.width);
  const wantH = idealOf(requested.height);
  const wantFps = idealOf(requested.frameRate);
  const details = {
    camera: t?.label ?? null,
    requested: { width: wantW, height: wantH, frameRate: wantFps, constraints: requested },
    delivered: s,
    measuredFps: fps,
    pump: pumpMode.value,
    pumpError,
  };
  if (!s?.width || !s.height) return makeEntry(`camera-format-${format}`, 'error', 'The camera reported no size', details);
  const fpsText = fps ? fps.fps.toFixed(1) : '—';
  const value = `${s.width}×${s.height} at ${s.frameRate ? Math.round(s.frameRate) : '?'} fps (measured ${fpsText})`;
  const wantLong = Math.max(wantW ?? 0, wantH ?? 0);
  const gotLong = Math.max(s.width, s.height);
  const status = wantLong && gotLong < 0.95 * wantLong ? 'partial' : 'yes';
  return makeEntry(`camera-format-${format}`, status, status === 'partial' ? `${value}; asked ${wantW}×${wantH}` : value, details);
}

function frameFormatEntry(before: unknown, pumpError: string | null): CheckEntry {
  const mode = pumpMode.value;
  const f = latestFrame.value;
  if (mode === 'off') return makeEntry('camera-frame-format', 'error', pumpError ?? 'The live helper did not start', { pumpError });
  if (!f || f === before) return makeEntry('camera-frame-format', 'error', 'No frames reached the live helper', { pump: mode });
  const how = mode === 'mstp' ? 'straight to the helper' : 'via the main thread';
  const read = f.timings.read;
  const value = `${f.format ?? 'unknown'}, ${how}${read != null ? `, copy ${formatMs(read)}` : ''}`;
  return makeEntry('camera-frame-format', mode === 'mstp' ? 'yes' : 'partial', value, {
    pump: mode,
    source: f.source,
    format: f.format,
    frame: `${f.width}×${f.height}`,
    analysisWidth: f.analysisWidth,
    timings: f.timings,
  });
}

/**
 * What the live frames look like as the helper receives them (orientation, sizes), so the marker
 * overlay's mapping can be checked against the real iPhone behaviour (RESEARCH §19 item 5).
 */
export function frameInfoEntry(video: HTMLVideoElement, before: unknown): CheckEntry {
  const f = latestFrame.value;
  const scr = typeof screen !== 'undefined' ? screen : null;
  const screenOrientation = scr?.orientation ? { type: scr.orientation.type, angle: scr.orientation.angle } : null;
  const pleaseAlsoCheck =
    'On the Live camera screen, point at the test marker and check the green outline sits on it with the phone upright and turned both ways sideways (see the iPhone checklist).';
  if (!f || f === before) {
    return makeEntry('camera-frame-info', 'skipped', 'No live frames to look at', { pump: pumpMode.value, video: `${video.videoWidth}×${video.videoHeight}`, screenOrientation });
  }
  const rotation = typeof f.rotation === 'number' ? f.rotation : null;
  const parts = [`${f.width}×${f.height}`, rotation == null ? 'rotation not reported' : `rotated ${rotation}°`];
  if (f.flip) parts.push('mirrored');
  if (screenOrientation) parts.push(`screen ${screenOrientation.type.replace(/-primary$/, '').replace(/-secondary$/, ' (other way)')}`);
  return makeEntry('camera-frame-info', 'yes', parts.join(' · '), {
    rotation,
    flip: f.flip ?? null,
    frameInfo: f.frameInfo ?? null,
    format: f.format,
    source: f.source,
    resultSize: `${f.width}×${f.height}`,
    analysisWidth: f.analysisWidth,
    video: `${video.videoWidth}×${video.videoHeight}`,
    screenOrientation,
    pleaseAlsoCheck,
  });
}

async function photoCheck(id: string, photoSettings: PhotoSettingsLike | null | 'current'): Promise<CheckEntry> {
  const askedFor = photoSettings === 'current' ? 'current format size' : photoSettings ?? 'no size';
  try {
    await waitLive(4000);
    const r = await takePhoto(photoSettings);
    r.workerGapMs = await trackerGap(r.startAbs, r.endAbs);
    const m = await measurePhoto(r.blob);
    const mp = megapixels(m.width, m.height);
    const details = {
      askedFor,
      requested: r.requested,
      width: m.width,
      height: m.height,
      megapixels: mp,
      orientation: m.orientation,
      bytes: m.bytes,
      type: m.type,
      ms: Math.round(r.ms),
      cameraPausedMs: Math.round(r.mutedMs),
      trackerFrameGapMs: r.workerGapMs == null ? null : Math.round(r.workerGapMs),
      zoom: zoomNow(),
      decodedBy: m.decodedBy,
      decodeMs: m.decodeMs,
      jpegHeader: m.header,
    };
    const timing = `${formatMs(r.ms)}, camera paused ${formatMs(r.mutedMs)}`;
    if (id === 'photo-48mp') {
      if (mp >= 40) return makeEntry(id, 'yes', `${sizeText(m.width, m.height)} · ${timing}`, details);
      return makeEntry(id, 'partial', `Got ${mp.toFixed(1)} MP instead (48 MP not available)`, details);
    }
    const status = photoStatus(r.requested, m.width, m.height);
    const asked = status === 'partial' && r.requested ? ` (asked ${r.requested.imageWidth}×${r.requested.imageHeight})` : '';
    return makeEntry(id, status, `${sizeText(m.width, m.height)}${asked} · ${timing}`, details);
  } catch (err) {
    return makeEntry(id, 'error', errorMessage(err), { askedFor });
  }
}

async function twoXEntry(h: RunHooks): Promise<CheckEntry> {
  const zoom = cameraInfo.value?.capabilities.zoom;
  const camera = currentTrack()?.label ?? null;
  if (!zoom || zoom.max < 2) return makeEntry('two-x-test', 'skipped', 'This camera has no 2× zoom', { zoom: zoom ?? null, camera });
  try {
    h.onProgress('2× lens test: photo at 1×… keep still');
    await setZoom(Math.max(1, zoom.min));
    await sleep(700);
    await waitLive(4000);
    const one = await takePhoto('current');
    const zoom1 = zoomNow();
    if (h.isAborted()) throw new Error('Stopped');
    h.onProgress('2× lens test: photo at 2×… keep still');
    await setZoom(2);
    await sleep(1500); // let it refocus
    await waitLive(4000);
    const two = await takePhoto('current');
    const zoom2 = zoomNow();
    await setZoom(1);
    // setZoom() swallows failures: comparing two 1× photos would give a wrong verdict.
    if (zoom2 != null && Math.abs(zoom2 - 2) > 0.05) {
      return makeEntry('two-x-test', 'error', `The camera did not switch to 2× (it reports ${zoom2}×)`, { camera, zoomAt1x: zoom1, zoomAt2x: zoom2 });
    }
    h.onProgress('2× lens test: comparing the two photos…');
    const reader = readerWorker();
    const info = await withTimeout(reader.ready, 90_000, 'Loading the image engine');
    if (!info?.ok) throw new Error(info?.error ?? 'The image engine is not available');
    const r = await withTimeout(reader.api.twoX(one.blob, two.blob), 60_000, 'Comparing the photos');
    const v = twoXVerdict(r);
    const two2x = await measurePhoto(two.blob).catch(() => null);
    const details = {
      ...r,
      camera,
      zoomAt1x: zoom1,
      zoomAt2x: zoom2,
      photoAt1x: { bytes: one.blob.size, ms: Math.round(one.ms), cameraPausedMs: Math.round(one.mutedMs) },
      photoAt2x: { bytes: two.blob.size, ms: Math.round(two.ms), cameraPausedMs: Math.round(two.mutedMs), width: two2x?.width, height: two2x?.height },
    };
    const mem = await reader.api.memory().catch(() => null);
    if (mem && mem.wasmBytes > READER_RESTART_BYTES) restartReader();
    return makeEntry('two-x-test', v.status, v.value, details);
  } catch (err) {
    await setZoom(1).catch(() => {});
    return makeEntry('two-x-test', 'error', errorMessage(err), { camera });
  }
}

/* ---------- the run ---------- */

/**
 * Starts the camera tests. MUST be called directly from a tap: the first getUserMedia call
 * happens synchronously here, so iOS can show its permission prompt.
 */
export function runCameraTests(h: CameraRunHooks): Promise<void> {
  safeStopPump();
  const firstStart = startCamera({ format: CAMERA_FORMATS[0] });
  return cameraSequence(h, firstStart);
}

async function cameraSequence(h: CameraRunHooks, firstStart: Promise<void>): Promise<void> {
  const video = h.video;
  /**
   * Every camera track this run started (camera.ts may replace the track when it restarts). Only
   * noted while the run is still wanted: after an abort the current track may be Live's.
   */
  const ownTracks = new Set<MediaStreamTrack>();
  const noteTrack = () => {
    if (h.isAborted()) return;
    const t = currentTrack();
    if (t) ownTracks.add(t);
  };
  try {
    for (let i = 0; i < CAMERA_FORMATS.length; i++) {
      const format = CAMERA_FORMATS[i]!;
      const name = FORMAT_NAMES[format];
      if (h.isAborted()) return;
      h.onProgress(`Starting the camera (${name})…`);
      safeStopPump();
      try {
        if (i === 0) await firstStart;
        else await startCamera({ format });
      } catch {
        /* startCamera reports failures through cameraState / cameraError */
      }
      noteTrack();
      if (h.isAborted()) return;
      if (cameraState.value !== 'live') {
        const raw = cameraError.value ?? 'The camera did not start';
        const refused = /permission|refused|NotAllowed/i.test(raw);
        const msg = refused ? 'Camera permission was refused. Tap "Start camera tests" again and choose Allow (or Settings › Safari › Camera).' : raw;
        h.onCheck(makeEntry(`camera-format-${format}`, 'error', msg, { cameraError: raw }));
        if (refused) return; // nothing else can work
        continue;
      }
      const requested = cameraInfo.value?.requested ?? constraintsFor(format);
      try {
        await attachPreview(video);
      } catch (err) {
        h.onCheck(makeEntry(`camera-format-${format}`, 'error', errorMessage(err)));
        continue;
      }

      if (i === 0) {
        try {
          for (const e of lensEntries()) h.onCheck(e);
        } catch (err) {
          h.onCheck(makeEntry('camera-lenses', 'error', errorMessage(err)));
        }
        h.onProgress('Testing the torch (it may flash)…');
        h.onCheck(await torchEntry().catch((err: unknown) => makeEntry('camera-torch', 'error', errorMessage(err))));
      }

      const before = latestFrame.value;
      let pumpError: string | null = null;
      h.onProgress('Connecting the live helper…');
      try {
        await withTimeout(startPump(video), 60_000, 'Starting the live helper');
      } catch (err) {
        pumpError = errorMessage(err);
      }
      if (h.isAborted()) return;
      h.onProgress(`Measuring the live video (${name})… keep still`);
      const fps = await measureFps(video, FPS_WINDOW_MS).catch(() => null);
      noteTrack();
      h.onCheck(formatEntry(format, requested, fps, pumpError));
      if (i === 0) {
        h.onCheck(frameFormatEntry(before, pumpError));
        h.onCheck(frameInfoEntry(video, before));
      }

      if (h.isAborted()) return;
      h.onProgress(`Taking a photo (${name}, exact size)… keep still`);
      h.onCheck(await photoCheck(`photo-${format}-current`, 'current'));
      await sleep(SETTLE_MS);
      if (h.isAborted()) return;
      h.onProgress(`Taking a photo (${name}, no size given)… keep still`);
      h.onCheck(await photoCheck(`photo-${format}-default`, null));

      if (format === 'auto-4x3') {
        await sleep(SETTLE_MS);
        if (h.isAborted()) return;
        h.onCheck(await twoXEntry(h));
        await sleep(SETTLE_MS);
        if (h.isAborted()) return;
        h.onProgress('Trying a 48 MP photo…');
        h.onCheck(await photoCheck('photo-48mp', SIZE_48MP));
      }
      await sleep(SETTLE_MS);
    }
  } finally {
    if (mayStopCamera(h.isAborted(), currentTrack(), ownTracks)) {
      safeStopPump();
      try {
        stopCamera();
      } catch (err) {
        logWarn('device', 'Stopping the camera failed', err);
      }
    }
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    video.srcObject = null;
  }
}

/** Result row for a photo from the iPhone's own camera screen (<input type=file capture>). */
export async function fileCameraEntry(file: File, openedAtAbs: number): Promise<CheckEntry> {
  const msFromOpen = openedAtAbs > 0 ? performance.timeOrigin + performance.now() - openedAtAbs : null;
  try {
    const m = await measurePhoto(file);
    const kind = (file.type || 'unknown').replace(/^image\//, '').toUpperCase();
    const value = `${sizeText(m.width, m.height)} · ${m.orientation} · ${kind} · ${formatBytes(file.size)}`;
    return makeEntry('file-camera', 'yes', value, {
      type: file.type || 'unknown',
      bytes: file.size,
      width: m.width,
      height: m.height,
      megapixels: megapixels(m.width, m.height),
      orientation: m.orientation,
      exifOrientation: m.header?.orientation ?? null,
      storedSize: m.header ? `${m.header.width}×${m.header.height}` : null,
      decodedBy: m.decodedBy,
      decodeMs: m.decodeMs,
      secondsWithCameraScreen: msFromOpen == null ? null : Math.round(msFromOpen / 100) / 10,
    });
  } catch (err) {
    return makeEntry('file-camera', 'error', errorMessage(err), { type: file.type, bytes: file.size });
  }
}
