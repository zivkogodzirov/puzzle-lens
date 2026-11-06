/**
 * Device check "Photo test" (added 2026-11-06 after the owner's first report: on their iPhone every
 * takePhoto() call failed, with "Internal error" when a size was given and "setMaxPhotoDimensions
 * failed" without one). It tries each likely cause ON ITS OWN and remembers what works, so Snap
 * can use it (settings.snapMethod):
 *   1. fresh camera, no tracking: no size / upright size / sideways size / largest size / the camera's
 *      own setting / from a copy of the camera;
 *   2. fresh camera, tracking with a FULL-SIZE copy;   3. fresh camera, tracking with the usual shrunk copy;
 *   4. the full-size live picture (grabFrame);   5. tracking paused;   6. tracking paused + camera restarted;
 * then the 2× lens test with whatever works. Second round (2026-11-06): each stage starts from a
 * freshly started camera, because once the shrunk copy has run, photos stay small until a restart.
 */
import { cameraInfo, cameraState, currentTrack, grabFullFrame, photoInfo, setZoom, startCamera, stopCamera } from '../camera/camera';
import { startPump, stopPumpAndWait } from '../camera/framePump';
import { takePhotoWith } from '../camera/snap';
import { describeSnapMethod, type PhotoSize, type SnapMethod } from '../camera/snapMethod';
import { settings } from '../app/settings';
import { Comlink, readerWorker } from '../app/workers';
import { trackSettings } from '../types/media';
import { logInfo } from '../log/logger';
import { attachPreview, measurePhoto, safeStopPump, waitLive } from './cameraChecks';
import { makeEntry } from './catalog';
import { formatMs, megapixels, sizeText, twoXVerdict } from './format';
import type { CameraRunHooks } from './cameraChecks';
import type { CheckEntry } from './types';
import { errorMessage, sleep, withTimeout } from './util';

export const PROBE_SIZES: readonly PhotoSize[] = ['none', 'as-delivered', 'landscape', 'caps-max', 'camera-default'];

type TakeMethod = Extract<SnapMethod, { kind: 'takePhoto' }>;

interface Attempt {
  id: string;
  method: TakeMethod;
  ok: boolean;
  pixels: number;
}

/** Starts the Photo test. MUST be called directly from a tap (camera permission). */
export function runPhotoProbe(h: CameraRunHooks): Promise<void> {
  safeStopPump();
  const firstStart = startCamera({ format: 'auto-4x3' });
  return probeSequence(h, firstStart);
}

async function tryPhoto(id: string, method: TakeMethod, h: CameraRunHooks): Promise<Attempt> {
  try {
    await waitLive(4000);
    const r = await takePhotoWith(method, null, 12_000, false);
    const m = await measurePhoto(r.blob);
    h.onCheck(
      makeEntry(id, 'yes', `${sizeText(m.width, m.height)} · ${formatMs(r.ms)}, camera paused ${formatMs(r.mutedMs)}`, {
        method,
        requested: r.requested,
        width: m.width,
        height: m.height,
        megapixels: megapixels(m.width, m.height),
        ms: Math.round(r.ms),
        cameraPausedMs: Math.round(r.mutedMs),
        bytes: m.bytes,
      }),
    );
    return { id, method, ok: true, pixels: m.width * m.height };
  } catch (err) {
    h.onCheck(makeEntry(id, 'error', errorMessage(err), { method }));
    return { id, method, ok: false, pixels: 0 };
  }
}

/** Pictures smaller than this share of the biggest one are never chosen (a 0.5 MP "photo" is useless). */
const SIZE_SHARE = 0.9;

/**
 * Best way to Snap: first only ways that give (nearly) the biggest picture; among those, in order:
 * tracking stays on with a full-size copy > tracking stays on > tracking paused > tracking paused and
 * the camera restarted (about a second) > the full-size live picture (softer); nothing: camera screen.
 */
export function chooseSnapMethod(r: { onFull?: Attempt[]; on?: Attempt[]; paused?: Attempt[]; restart?: Attempt[]; grab: { ok: boolean; pixels: number } }): SnapMethod {
  const groups: Array<[Attempt[], Partial<TakeMethod>]> = [
    [r.onFull ?? [], { pauseTracking: false, fullSizeTracking: true, restartCamera: false }],
    [r.on ?? [], { pauseTracking: false, fullSizeTracking: false, restartCamera: false }],
    [r.paused ?? [], { pauseTracking: true, fullSizeTracking: false, restartCamera: false }],
    [r.restart ?? [], { pauseTracking: true, fullSizeTracking: false, restartCamera: true }],
  ];
  const all = groups.flatMap(([xs]) => xs).filter((a) => a.ok);
  const maxPixels = Math.max(0, r.grab.ok ? r.grab.pixels : 0, ...all.map((a) => a.pixels));
  if (maxPixels === 0) return { kind: 'file' };
  const big = (a: Attempt) => a.ok && a.pixels >= SIZE_SHARE * maxPixels;
  for (const [xs, how] of groups) {
    const best = xs.filter(big).sort((a, b) => b.pixels - a.pixels)[0];
    if (best) return { ...best.method, ...how } as TakeMethod;
  }
  return { kind: 'grabFrame' };
}

async function probeSequence(h: CameraRunHooks, firstStart: Promise<void>): Promise<void> {
  const own = new Set<MediaStreamTrack>();
  try {
    h.onProgress('Starting the camera…');
    await firstStart;
    const t = currentTrack();
    if (t) own.add(t);
    if (cameraState.value !== 'live') throw new Error('The camera did not start');
    await attachPreview(h.video);
    await waitLive(4000);
    await sleep(800);

    const info = await photoInfo();
    h.onCheck(
      makeEntry('photo-probe-info', info.error ? 'partial' : 'yes', info.error ?? 'Read', {
        trackSettings: t ? trackSettings(t) : null,
        photoCapabilities: info.capabilities,
        photoSettings: info.settings,
        camera: t?.label ?? null,
      }),
    );

    // 1. Live tracking OFF: one cause at a time.
    const off: Attempt[] = [];
    for (const size of PROBE_SIZES) {
      if (h.isAborted()) return;
      h.onProgress(`Photo test: tracking off, ${size}… keep still`);
      off.push(await tryPhoto(`photo-probe-off-${size}`, { kind: 'takePhoto', size, pauseTracking: false, onClone: false }, h));
    }
    h.onProgress('Photo test: from a copy of the camera… keep still');
    off.push(await tryPhoto('photo-probe-off-clone', { kind: 'takePhoto', size: 'none', pauseTracking: false, onClone: true }, h));

    const worked = off.filter((a) => a.ok && !a.method.onClone).map((a) => a.method);
    const sizesToTry: TakeMethod[] = worked.length
      ? worked
      : [
          { kind: 'takePhoto', size: 'none', pauseTracking: false, onClone: false },
          { kind: 'takePhoto', size: 'as-delivered', pauseTracking: false, onClone: false },
        ];
    const label = (m: TakeMethod) => (m.onClone ? 'clone' : m.size);
    /** Each stage starts with a freshly started camera, so one stage can't affect the next. */
    const freshCamera = async (msg: string) => {
      h.onProgress(msg);
      await stopPumpAndWait();
      await startCamera({ format: 'auto-4x3' });
      const t2 = currentTrack();
      if (t2) own.add(t2);
      if (cameraState.value !== 'live') throw new Error('The camera did not restart');
      await attachPreview(h.video);
      await waitLive(4000);
      await sleep(800);
    };

    // 2. Fresh camera, live tracking with a FULL-SIZE copy of the camera (the worker shrinks it on the GPU).
    if (h.isAborted()) return;
    await freshCamera('Photo test: restarting the camera for full-size tracking…');
    await startPump(h.video, { fullSizeClone: true });
    await sleep(1500);
    const onFull: Attempt[] = [];
    for (const m of sizesToTry) {
      if (h.isAborted()) return;
      h.onProgress(`Photo test: full-size tracking, ${label(m)}… keep still`);
      onFull.push(await tryPhoto(`photo-probe-onfull-${label(m)}`, { ...m, fullSizeTracking: true }, h));
    }

    // 3. Fresh camera, live tracking with the usual SHRUNK copy.
    if (h.isAborted()) return;
    await freshCamera('Photo test: restarting the camera for normal tracking…');
    await startPump(h.video, { fullSizeClone: false });
    await sleep(1500);
    const on: Attempt[] = [];
    for (const m of sizesToTry) {
      if (h.isAborted()) return;
      h.onProgress(`Photo test: tracking on, ${label(m)}… keep still`);
      on.push(await tryPhoto(`photo-probe-on-${label(m)}`, m, h));
    }

    // 4. The full-size live picture (tracking still on).
    if (h.isAborted()) return;
    h.onProgress('Photo test: full-size live picture…');
    let grab = { ok: false, pixels: 0 };
    try {
      const g = await grabFullFrame();
      const w = g.bitmap.width;
      const hh = g.bitmap.height;
      g.bitmap.close();
      grab = { ok: true, pixels: w * hh };
      h.onCheck(makeEntry('photo-probe-grab', w * hh >= 8e6 ? 'yes' : 'partial', `${sizeText(w, hh)} · ${formatMs(g.ms)}`, { width: w, height: hh, ms: Math.round(g.ms) }));
    } catch (err) {
      h.onCheck(makeEntry('photo-probe-grab', 'error', errorMessage(err)));
    }

    // 5. Tracking paused (its copy closed), camera NOT restarted.
    const base = sizesToTry[0]!;
    if (h.isAborted()) return;
    h.onProgress('Photo test: tracking paused… keep still');
    const paused = [await tryPhoto(`photo-probe-paused-${label(base)}`, { ...base, pauseTracking: true }, h)];

    // 6. Tracking paused AND the camera restarted just before the photo.
    if (h.isAborted()) return;
    await startPump(h.video, { fullSizeClone: false });
    await sleep(1500);
    h.onProgress('Photo test: tracking paused and camera restarted… keep still');
    const restart = [await tryPhoto(`photo-probe-restart-${label(base)}`, { ...base, pauseTracking: true, restartCamera: true }, h)];

    // Choose and remember.
    const choice = chooseSnapMethod({ onFull, on, paused, restart, grab });
    settings.snapMethod.value = JSON.stringify(choice);
    const status = choice.kind === 'file' ? 'no' : choice.kind === 'grabFrame' || choice.pauseTracking ? 'partial' : 'yes';
    h.onCheck(makeEntry('photo-probe-choice', status, `Snap will use: ${describeSnapMethod(choice)}`, { choice }));
    logInfo('device', `Photo test chose: ${describeSnapMethod(choice)}`, { choice });

    // 4. The 2× lens test with what works (tracking set up the way Snap will have it).
    if (choice.kind !== 'file' && !h.isAborted()) {
      // Both 2× photos are taken from one freshly started camera (a restart would reset the zoom).
      await freshCamera('2× lens test: getting the camera ready…');
      let how: Exclude<SnapMethod, { kind: 'file' }> = choice;
      if (choice.kind === 'takePhoto') {
        if (choice.pauseTracking || choice.restartCamera) how = { ...choice, pauseTracking: false, restartCamera: false };
        else await startPump(h.video);
      } else {
        await startPump(h.video);
      }
      await sleep(1000);
      h.onCheck(await twoXWith(how, h));
    }
  } finally {
    safeStopPump();
    const t = currentTrack();
    if (!h.isAborted() || t === null || own.has(t)) stopCamera();
  }
}

async function twoXWith(choice: Exclude<SnapMethod, { kind: 'file' }>, h: CameraRunHooks): Promise<CheckEntry> {
  const zoom = cameraInfo.value?.capabilities.zoom;
  if (!zoom || zoom.max < 2) return makeEntry('two-x-test', 'skipped', 'This camera has no 2× zoom');
  const zoomNow = () => {
    const t = currentTrack();
    return t ? (trackSettings(t).zoom ?? null) : null;
  };
  try {
    const reader = readerWorker();
    const info = await withTimeout(reader.ready, 90_000, 'Loading the image engine');
    if (!info?.ok) throw new Error(info?.error ?? 'The image engine is not available');
    h.onProgress('2× lens test: picture at 1×… keep still');
    await setZoom(1);
    await sleep(1000);
    await waitLive(4000);
    if (choice.kind === 'grabFrame') {
      const one = await grabFullFrame();
      h.onProgress('2× lens test: picture at 2×… keep still');
      await setZoom(2);
      await sleep(1500);
      const z2 = zoomNow();
      const two = await grabFullFrame();
      await setZoom(1);
      if (z2 != null && Math.abs(z2 - 2) > 0.05) {
        one.bitmap.close();
        two.bitmap.close();
        return makeEntry('two-x-test', 'error', `The camera did not switch to 2× (it reports ${z2}×)`);
      }
      const r = await withTimeout(reader.api.twoXFrames(Comlink.transfer(one.bitmap, [one.bitmap]), Comlink.transfer(two.bitmap, [two.bitmap])), 60_000, 'Comparing the pictures');
      const v = twoXVerdict(r);
      return makeEntry('two-x-test', v.status, v.value, { ...r, via: 'full-size live pictures', zoomAt2x: z2 });
    }
    const one = await takePhotoWith(choice, h.video, 20_000);
    h.onProgress('2× lens test: picture at 2×… keep still');
    await setZoom(2);
    await sleep(1500);
    await waitLive(4000);
    const z2 = zoomNow();
    const two = await takePhotoWith(choice, h.video, 20_000);
    await setZoom(1);
    if (z2 != null && Math.abs(z2 - 2) > 0.05) return makeEntry('two-x-test', 'error', `The camera did not switch to 2× (it reports ${z2}×)`);
    const r = await withTimeout(reader.api.twoX(one.blob, two.blob), 60_000, 'Comparing the photos');
    const v = twoXVerdict(r);
    return makeEntry('two-x-test', v.status, v.value, { ...r, via: describeSnapMethod(choice), zoomAt2x: z2 });
  } catch (err) {
    await setZoom(1).catch(() => {});
    return makeEntry('two-x-test', 'error', errorMessage(err));
  }
}
