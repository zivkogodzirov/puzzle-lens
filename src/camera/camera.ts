/**
 * The camera: start/stop, lens choice, zoom, torch, recovery after interruptions, and Snap
 * (full-resolution photo) under the capture contract of PLAN §3.1:
 *   1. open a 4:3 full-sensor format when available, so a Snap needs no format switch;
 *   2. the tracker gets a clone of the track (framePump.ts);
 *   3. takePhoto() is called with an explicit size = the current format; the real size is recorded;
 *   4. while a Snap or the system camera is in progress, mute/unmute is expected and recovery waits;
 *   5. what actually happens on the phone is measured by the Device check.
 */
import { signal } from '@preact/signals';
import { imageCaptureCtor, trackCapabilities, trackSettings, type CameraCapabilities, type CameraSettings, type PhotoSettingsLike } from '../types/media';
import { settings, type LiveFormat } from '../app/settings';
import { logError, logInfo, logWarn } from '../log/logger';
import { keepAwake } from './wakeLock';

export type CameraState = 'idle' | 'starting' | 'live' | 'paused' | 'error';

export interface CameraInfo {
  label: string;
  deviceId: string;
  requested: MediaTrackConstraints;
  settings: CameraSettings;
  capabilities: CameraCapabilities;
}

export interface SnapResult {
  blob: Blob;
  method: 'takePhoto' | 'file-input';
  requested: PhotoSettingsLike | null;
  ms: number;
  /** How long the camera was muted while the photo was taken. */
  mutedMs: number;
  /** Longest gap in frames reaching the tracker during the Snap (filled in by framePump). */
  workerGapMs: number | null;
  startAbs: number;
  endAbs: number;
}

export const cameraState = signal<CameraState>('idle');
export const cameraInfo = signal<CameraInfo | null>(null);
export const cameraError = signal<string | null>(null);
export const cameraDevices = signal<MediaDeviceInfo[]>([]);
/** The live stream (for the <video> element). */
export const cameraStream = signal<MediaStream | null>(null);
export const snapping = signal(false);

const PAUSE_AFTER_MUTE_MS = 2500;

let stream: MediaStream | null = null;
let track: MediaStreamTrack | null = null;
let stoppingOnPurpose = false;
let resumeOnVisible = false;
let mutedSince: number | null = null;
let mutedTotalDuringSnap = 0;
let muteTimer: ReturnType<typeof setTimeout> | null = null;
/** Set while the system camera (file input) is open, so its interruption isn't treated as a failure. */
let externalCaptureActive = false;
/** Bumped by every start/stop, so a start that is overtaken by a newer start/stop gives its camera back. */
let startGen = 0;

export function currentTrack(): MediaStreamTrack | null {
  return track;
}

export function constraintsFor(format: LiveFormat, deviceId?: string): MediaTrackConstraints {
  const base: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } };
  switch (format) {
    case '4k':
      return { ...base, width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } };
    case '1080p':
      return { ...base, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
    default:
      // 4:3 full sensor (12 MP on recent iPhones): Snaps then need no format switch.
      return { ...base, width: { ideal: 4032 }, height: { ideal: 3024 }, aspectRatio: { ideal: 4 / 3 }, frameRate: { ideal: 30 } };
  }
}

/** iPhone's physical wide camera: steady geometry, no automatic switch to macro (RESEARCH §3). */
export function pickPhysicalBackCamera(devices: MediaDeviceInfo[]): MediaDeviceInfo | undefined {
  const video = devices.filter((d) => d.kind === 'videoinput');
  return video.find((d) => /^back camera$/i.test(d.label.trim())) ?? video.find((d) => /back/i.test(d.label) && !/(dual|triple|ultra|tele)/i.test(d.label));
}

async function refreshDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    cameraDevices.value = list.filter((d) => d.kind === 'videoinput');
    return list;
  } catch {
    return [];
  }
}

function publishInfo(requested: MediaTrackConstraints): void {
  if (!track) return;
  cameraInfo.value = {
    label: track.label,
    deviceId: trackSettings(track).deviceId ?? '',
    requested,
    settings: trackSettings(track),
    capabilities: trackCapabilities(track),
  };
}

function startPauseTimer(t: MediaStreamTrack): void {
  if (muteTimer) clearTimeout(muteTimer);
  muteTimer = setTimeout(() => {
    if (t === track && t.muted && !snapping.value && !externalCaptureActive && cameraState.value === 'live') {
      cameraState.value = 'paused';
      logWarn('camera', 'Camera paused by the system');
    }
  }, PAUSE_AFTER_MUTE_MS);
}

/**
 * Recovery is held off while a Snap or the system camera is in progress (PLAN §3.1 item 4). When
 * that ends, look again: if the camera is still muted, start the normal pause timer; if it ended,
 * restart it. Otherwise a frozen picture would keep saying "Live".
 */
function armRecovery(): void {
  const t = track;
  if (!t || snapping.value || externalCaptureActive) return;
  if (t.readyState === 'ended') {
    if (document.visibilityState === 'visible') void startCamera();
  } else if (t.muted) {
    startPauseTimer(t);
  }
}

function wireTrackEvents(t: MediaStreamTrack): void {
  t.addEventListener('mute', () => {
    if (t !== track) return; // an old camera that is being replaced
    mutedSince = performance.now();
    if (snapping.value || externalCaptureActive) return; // expected during a Snap (PLAN §3.1 item 4)
    startPauseTimer(t);
  });
  t.addEventListener('unmute', () => {
    if (t !== track) return;
    if (mutedSince !== null && snapping.value) mutedTotalDuringSnap += performance.now() - mutedSince;
    mutedSince = null;
    if (muteTimer) clearTimeout(muteTimer);
    if (cameraState.value === 'paused') cameraState.value = 'live';
  });
  t.addEventListener('ended', () => {
    if (stoppingOnPurpose || t !== track) return;
    logWarn('camera', 'Camera track ended unexpectedly');
    cameraState.value = 'paused';
    if (document.visibilityState === 'visible' && !snapping.value && !externalCaptureActive) void startCamera().catch(() => {});
  });
}

/** Plain-English explanation of why the camera didn't start. */
export function cameraErrorText(err: unknown): string {
  const e = err as DOMException | undefined;
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was refused. Tap "Start camera" again and choose Allow. If it keeps failing: iPhone Settings › Apps › Safari › Camera › Allow.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is busy. Close any other app that uses the camera (or a FaceTime call), then tap "Start camera".';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'The chosen camera could not be found. Pick "Automatic" in the lens list, then tap "Start camera".';
    default:
      return 'The camera could not start. Tap "Start camera" to try again. If it keeps happening, close Puzzle Lens and open it again.';
  }
}

/**
 * Starts the camera. The very first call must come from a tap (iOS asks for permission).
 * Home Screen apps currently ask again on every launch (WebKit bug 327237, RESEARCH §3).
 */
export async function startCamera(opts: { deviceId?: string; format?: LiveFormat } = {}): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraState.value = 'error';
    cameraError.value = 'This browser has no camera access (it must be Safari, and the address must start with https).';
    return;
  }
  stopCamera();
  const gen = ++startGen;
  cameraState.value = 'starting';
  cameraError.value = null;
  const format = opts.format ?? settings.liveFormat.value;
  const savedId = settings.cameraDeviceId.value || undefined;
  let deviceId = opts.deviceId ?? savedId;
  /** Streams opened by this call that are not (yet) the live one; stopped if this call is overtaken. */
  const opened: MediaStream[] = [];
  const open = async (c: MediaTrackConstraints) => {
    const s = await navigator.mediaDevices.getUserMedia({ video: c, audio: false });
    opened.push(s);
    if (gen !== startGen) throw new Superseded();
    return s;
  };
  try {
    let requested = constraintsFor(format, deviceId);
    let s: MediaStream;
    try {
      s = await open(requested);
    } catch (err) {
      // A lens saved earlier no longer matches (ids changed, wrong lens picked): go back to automatic.
      const name = (err as DOMException)?.name;
      if (deviceId && deviceId === savedId && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
        logWarn('camera', 'The saved lens is not available any more; switching back to automatic', err);
        settings.cameraDeviceId.value = '';
        deviceId = undefined;
        requested = constraintsFor(format);
        s = await open(requested);
      } else {
        throw err;
      }
    }
    let t = s.getVideoTracks()[0] ?? null;
    // First time: labels are only available after permission. Prefer the physical back camera.
    const list = await refreshDevices();
    if (gen !== startGen) throw new Superseded();
    if (!deviceId) {
      const physical = pickPhysicalBackCamera(list);
      if (physical && t && t.label !== physical.label) {
        s.getTracks().forEach((x) => x.stop());
        deviceId = physical.deviceId;
        requested = constraintsFor(format, deviceId);
        s = await open(requested);
        t = s.getVideoTracks()[0] ?? null;
      }
    }
    if (!t) throw new Error('No video track');
    // This call won: everything else it opened can go.
    for (const o of opened) if (o !== s) o.getTracks().forEach((x) => x.stop());
    stream = s;
    track = t;
    wireTrackEvents(t);
    cameraStream.value = s;
    publishInfo(requested);
    cameraState.value = 'live';
    keepAwake(true);
    const st = trackSettings(t);
    logInfo('camera', `Camera on: ${t.label} ${st.width}×${st.height} @ ${st.frameRate ?? '?'} fps`, { requested, settings: st });
  } catch (err) {
    for (const o of opened) o.getTracks().forEach((x) => x.stop());
    if (err instanceof Superseded || gen !== startGen) return; // a newer start/stop took over; it owns the state
    stopTracks();
    cameraState.value = 'error';
    cameraError.value = cameraErrorText(err);
    logError('camera', 'Camera failed to start', err);
  }
}

class Superseded extends Error {
  constructor() {
    super('Camera start was overtaken by a newer start or stop');
  }
}

function stopTracks(): void {
  stoppingOnPurpose = true;
  stream?.getTracks().forEach((t) => t.stop());
  stoppingOnPurpose = false;
  stream = null;
  track = null;
}

export function stopCamera(): void {
  startGen++;
  if (muteTimer) clearTimeout(muteTimer);
  stopTracks();
  cameraStream.value = null;
  if (cameraState.value !== 'error') cameraState.value = 'idle';
  keepAwake(false);
}

export async function setZoom(zoom: number): Promise<void> {
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] });
    publishInfo(cameraInfo.value?.requested ?? {});
  } catch (err) {
    logWarn('camera', `Zoom ${zoom} not possible`, err);
  }
}

export async function setTorch(on: boolean): Promise<void> {
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    publishInfo(cameraInfo.value?.requested ?? {});
  } catch (err) {
    logWarn('camera', 'Torch not possible', err);
  }
}

/** The size the camera currently delivers, as (long side, short side): AVFoundation's photo sizes are landscape. */
export function currentPhotoSize(): PhotoSettingsLike | null {
  if (!track) return null;
  const s = trackSettings(track);
  if (!s.width || !s.height) return null;
  return { imageWidth: Math.max(s.width, s.height), imageHeight: Math.min(s.width, s.height) };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} didn't come back from the camera within ${Math.round(ms / 1000)} seconds`)), ms);
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

export function hasImageCapture(): boolean {
  return Boolean(imageCaptureCtor());
}

/**
 * Takes a full-resolution photo with ImageCapture. `photoSettings: 'current'` (default) applies
 * the capture contract; `null` calls takePhoto() with no settings; an object is passed through
 * (used by the Device check to measure what each choice does).
 */
export async function takePhoto(photoSettings: PhotoSettingsLike | null | 'current' = 'current'): Promise<SnapResult> {
  const Ctor = imageCaptureCtor();
  if (!Ctor) throw new Error('ImageCapture is not available');
  if (!track || cameraState.value !== 'live') throw new Error('The camera is not running');
  const requested = photoSettings === 'current' ? currentPhotoSize() : photoSettings;
  snapping.value = true;
  mutedTotalDuringSnap = 0;
  if (track.muted && mutedSince === null) mutedSince = performance.now();
  const startAbs = performance.timeOrigin + performance.now();
  const t0 = performance.now();
  try {
    const capture = new Ctor(track);
    const blob = await withTimeout(requested ? capture.takePhoto(requested) : capture.takePhoto(), 20_000, 'The photo');
    // Let a trailing unmute arrive before measuring.
    await new Promise((r) => setTimeout(r, 300));
    if (mutedSince !== null) mutedTotalDuringSnap += performance.now() - mutedSince;
    const ms = performance.now() - t0;
    logInfo('snap', `Photo taken in ${Math.round(ms)} ms (${Math.round(blob.size / 1024)} KB)`, { requested });
    return { blob, method: 'takePhoto', requested, ms, mutedMs: mutedTotalDuringSnap, workerGapMs: null, startAbs, endAbs: performance.timeOrigin + performance.now() };
  } finally {
    snapping.value = false;
    if (track && !track.muted) mutedSince = null;
    armRecovery();
  }
}

/** Called around the system camera (file input) so its interruption isn't treated as a failure. */
export function setExternalCapture(active: boolean): void {
  externalCaptureActive = active;
  if (!active) armRecovery();
}

/* Release the camera when the app is hidden (saves battery; iOS stops it anyway) and resume after. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (externalCaptureActive) return;
    resumeOnVisible = cameraState.value === 'live' || cameraState.value === 'paused';
    if (resumeOnVisible) stopCamera();
  } else if (resumeOnVisible) {
    resumeOnVisible = false;
    void startCamera();
  }
});
