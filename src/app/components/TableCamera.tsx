import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { TestButton } from './TestSteps';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/icons';
import { errorWords } from '../words';
import { cameraError, cameraInfo, cameraState, cameraStream, setZoom, startCamera, stopCamera } from '../../camera/camera';
import { latestFrame, pumpError, pumpMode, startPump, stopPump } from '../../camera/framePump';
import { capturePhoto, snapBusy } from '../../camera/snap';
import { frameRotation } from '../../camera/coords';
import { trackerWorker } from '../workers';
import { MarkerOverlay } from './MarkerOverlay';
import { PieceOverlay } from './PieceOverlay';
import { CameraStatus, LevelGauge } from './LevelGauge';
import { AutoCapture, FREE_RULES, FreeCapture, RULES, type CaptureKind, type GaugeState } from '../../scan/autoCapture';
import { level, levelPermission, requestLevelSensor } from '../../scan/levelSensor';
import { MARKER_COUNT } from '../../markers/layout';
import type { TableFix } from '../../geo/tableFix';
import type { MarkerMap, PieceRow, Vec2 } from '../../project/types';
import { logInfo, logWarn } from '../../log/logger';

export type TableCameraMode = 'setup' | CaptureKind;

export interface CaptureMeta {
  zoom: number;
  fix: TableFix | null;
  auto: boolean;
  /** Tilt from the phone's sensor when the photo was taken (deg), or null. */
  sensorTiltDeg: number | null;
}

/** Turns an image-space direction from the tracker's frame into screen space. */
function toScreen(v: Vec2, rot: 0 | 90 | 180 | 270): Vec2 {
  switch (rot) {
    case 90:
      return [-v[1], v[0]];
    case 180:
      return [-v[0], -v[1]];
    case 270:
      return [v[1], -v[0]];
    default:
      return v;
  }
}

/** Set-up photo: all 8 markers in view and the picture steady (marker centres within 0.6 % of the width for 500 ms). */
class SetupCapture {
  private since = 0;
  private last: Map<number, Vec2> | null = null;
  private firedAt = Number.NEGATIVE_INFINITY;
  update(t: number, markers: Array<{ id: number; corners: number[] }>, width: number): GaugeState {
    const ids = new Set(markers.filter((m) => m.id < MARKER_COUNT).map((m) => m.id));
    const base = { tiltDeg: null, heightMm: null, leanImg: [0, 0] as Vec2, targetMm: null, targetDirImg: null };
    if (ids.size < MARKER_COUNT) {
      this.last = null;
      return {
        ...base,
        status: ids.size ? 'area-out' : 'no-markers',
        message: `${ids.size} of ${MARKER_COUNT} markers in view — raise the phone until all 8 show`,
        steady: 0,
      };
    }
    const now = new Map(markers.map((m) => [m.id, [(m.corners[0]! + m.corners[4]!) / 2, (m.corners[1]! + m.corners[5]!) / 2] as Vec2]));
    const moved = this.last
      ? [...now].some(([id, p]) => {
          const q = this.last!.get(id);
          return !q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.006 * width;
        })
      : true;
    if (moved) {
      this.last = now;
      this.since = t;
    }
    const steady = Math.min(1, (t - this.since) / 500);
    if (steady >= 1 && t - this.firedAt > 2500) return { ...base, status: 'ready', message: 'All 8 markers — taking the photo…', steady };
    return { ...base, status: 'hold-still', message: 'All 8 markers in view — hold still', steady };
  }
  noteFired(t: number): void {
    this.firedAt = t;
    this.last = null;
  }
  reset(): void {
    this.last = null;
  }
}

/**
 * The camera for puzzle photos (set-up and scanning): live video with marker outlines, the
 * level-and-height gauge, and photos that take themselves when the phone is ready. The big
 * button takes one at any time.
 *
 * M9 part 5 (design plan §3.5 camera chrome, §4 item 5): laid out like the iPhone Camera app. The top bar
 * has Back, the screen's own buttons, zoom and 🧪, with the status capsule (the one instruction and a level
 * dot) under it; the level is a reticle in the middle with no panel; the dock at the bottom has the mode
 * words, the last photo, the shutter (its ring fills while the phone is held still, before a photo takes
 * itself) and Photos. The tilt sensor question and a camera that is off are one card each in the middle.
 * Sideways (a Safari tab) the dock is a column on the right.
 */
export function TableCamera(props: {
  mode: TableCameraMode;
  map: MarkerMap | null;
  target?: Vec2 | null;
  /** Words to show while the last photo is being processed (blocks new photos). */
  busy: string | null;
  autoCapture?: boolean;
  /** Catalogued pieces to outline over the video. */
  pieces?: PieceRow[];
  onPhoto: (blob: Blob, meta: CaptureMeta) => void;
  onClose: () => void;
  children?: ComponentChildren;
  /** Marker-free puzzle: the gauge uses the tilt sensor and the pieces' apparent size (nominal piece pitch in mm). */
  free?: { pitchMm: number } | null;
  /** M9 part 5: more icon buttons in the top bar, after Back (the scan's gear). */
  topExtra?: ComponentChildren;
  /** The mode words over the shutter (the scan's Whole table / Close-ups). */
  modes?: ComponentChildren;
  /** The dock left and right of the shutter (the last photo; Photos), 50 px each. */
  dockLeft?: ComponentChildren;
  dockRight?: ComponentChildren;
  /** The row just above the dock (the scan's mini map and counts). */
  above?: ComponentChildren;
}) {
  const {
    mode,
    map,
    target = null,
    busy,
    autoCapture = true,
    pieces,
    onPhoto,
    onClose,
    children,
    free = null,
    topExtra,
    modes,
    dockLeft,
    dockRight,
    above,
  } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [gauge, setGauge] = useState<GaugeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Not now" on the tilt sensor card: a small button under the status capsule instead (M9 part 5).
  const [tiltLater, setTiltLater] = useState(false);
  const ac = useRef(new AutoCapture());
  const sc = useRef(new SetupCapture());
  const fc = useRef(new FreeCapture());
  const taking = useRef(false);
  const lastFix = useRef<TableFix | null>(null);
  const wantZoom = mode === 'detail' ? 2 : 1;
  const state = cameraState.value;
  const stream = cameraStream.value;
  const zoom = cameraInfo.value?.settings.zoom ?? 1;
  const live = state === 'live';
  // Props used inside the long-lived frame subscription.
  const cur = useRef({ mode, map, target, busy, autoCapture, onPhoto, zoom, free });
  cur.current = { mode, map, target, busy, autoCapture, onPhoto, zoom, free };

  useEffect(() => {
    if (cameraState.value === 'idle' || cameraState.value === 'error') void startCamera();
    return () => {
      try {
        stopPump();
      } finally {
        stopCamera();
      }
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let onPlaying: (() => void) | null = null;
    if (stream && v.srcObject !== stream) {
      v.srcObject = stream;
      onPlaying = () => void startPump(v);
      v.addEventListener('playing', onPlaying, { once: true });
      void v.play().catch(() => {});
    }
    if (!stream) {
      stopPump();
      v.srcObject = null;
    }
    setVideoEl(v);
    return () => {
      if (onPlaying) v.removeEventListener('playing', onPlaying);
    };
  }, [stream]);

  // The right lens zoom for this kind of photo, and the marker map for the tracker.
  useEffect(() => {
    if (live && Math.abs(zoom - wantZoom) > 0.05 && (cameraInfo.value?.capabilities.zoom?.max ?? 1) >= wantZoom) void setZoom(wantZoom);
  }, [live, wantZoom]);
  useEffect(() => {
    void trackerWorker().api.setTableMap(map, zoom);
    void trackerWorker().api.setPieceStats(Boolean(free));
  }, [map, zoom]);

  // Switching between overview and close-ups starts afresh.
  useEffect(() => {
    fc.current.resetFired();
  }, [mode]);

  // Photos may take themselves again (the result card, the viewer or a sheet closed): the steadiness starts afresh,
  // so the ring fills visibly before a photo, never at once under the finger that closed it (review 2026-11-11).
  useEffect(() => {
    if (autoCapture) {
      ac.current.reset();
      fc.current.reset();
      sc.current.reset();
    }
  }, [autoCapture]);

  // A steady streak that built up while the last photo was processed must not fire straight away.
  useEffect(() => {
    if (!busy) {
      ac.current.reset();
      fc.current.reset();
      sc.current.reset();
    }
  }, [busy]);

  const take = async (auto: boolean) => {
    if (taking.current || snapBusy.value || cur.current.busy) return;
    taking.current = true;
    const t = performance.now();
    ac.current.noteFired(t);
    fc.current.noteFired(t);
    sc.current.noteFired(t);
    const meta: CaptureMeta = {
      zoom: cur.current.zoom,
      fix: lastFix.current,
      auto,
      sensorTiltDeg: levelPermission.value === 'granted' ? (level.value?.tiltDeg ?? null) : null,
    };
    try {
      const { blob } = await capturePhoto(videoRef.current);
      setError(null);
      cur.current.onPhoto(blob, meta);
    } catch (err) {
      setError(errorWords(err));
      logWarn('scan', 'Photo failed', err);
    } finally {
      taking.current = false;
    }
  };

  // Every tracker result updates the gauge, and may fire the photo.
  useEffect(
    () =>
      latestFrame.subscribe((f) => {
        if (!f) return;
        const c = cur.current;
        const t = performance.now();
        lastFix.current = f.table;
        let g: GaugeState;
        if (c.mode === 'setup') g = sc.current.update(t, f.markers, f.width);
        else if (c.free) {
          const lv = level.value;
          const sensor = levelPermission.value === 'granted' && lv !== null;
          g = fc.current.update(
            t,
            { tiltDeg: sensor ? lv.tiltDeg : null, pieces: f.pieces, frame: { width: f.width, height: f.height } },
            { kind: c.mode, pitchMm: c.free.pitchMm, sensor },
          );
          // Until the tilt sensor answers (not yet allowed, or no reading yet), never fire by itself:
          // a tilted first photo would become the table for the whole puzzle.
          const pending = levelPermission.value === 'unknown' || (levelPermission.value === 'granted' && lv === null);
          if (pending && g.status === 'ready') g = { ...g, status: 'hold-still', message: 'Allow the tilt sensor first (or tap the button)', steady: 0 };
        } else {
          g = ac.current.update(t, f.table, { kind: c.mode, map: c.map, frame: { width: f.width, height: f.height }, targetMm: c.target, targetTolMm: 60 });
          // No marker in view (middle close-up): fall back to the tilt sensor for "hold it flat".
          if (!f.table && c.mode === 'detail' && level.value) {
            const lv = level.value;
            g = {
              ...g,
              tiltDeg: lv.tiltDeg,
              leanImg: [0, 0],
              message: lv.tiltDeg > RULES.detail.maxTiltDeg ? 'Hold the phone flat' : 'No marker in view: keep the height and tap the button',
            };
          }
        }
        const v = videoRef.current;
        const rot = v && v.videoWidth ? frameRotation({ width: f.width, height: f.height }, { width: v.videoWidth, height: v.videoHeight }, f.rotation) : 0;
        g = { ...g, leanImg: toScreen(g.leanImg, rot), targetDirImg: g.targetDirImg ? toScreen(g.targetDirImg, rot) : null };
        // The tilt sensor's lean is already in screen coordinates.
        if ((c.free || (!f.table && c.mode === 'detail')) && level.value) g = { ...g, leanImg: level.value.lean };
        setGauge(g);
        if (g.status === 'ready' && c.autoCapture && !c.busy && !taking.current) {
          logInfo('scan', `Automatic ${c.mode} photo`, { heightMm: g.heightMm, tiltDeg: g.tiltDeg, pieces: f.pieces, frame: [f.width, f.height] });
          void take(true);
        }
      }),
    [],
  );

  const maxTilt = free
    ? FREE_RULES[mode === 'detail' ? 'detail' : 'overview'].maxTiltDeg
    : mode === 'detail'
      ? RULES.detail.maxTiltDeg
      : RULES.overview.maxTiltDeg;
  const tilt = gauge?.tiltDeg ?? (mode === 'detail' && level.value ? level.value.tiltDeg : null);
  const lean: Vec2 = gauge && gauge.tiltDeg !== null ? gauge.leanImg : (level.value?.lean ?? [0, 0]);
  const problem = (live && pumpError.value) || error || cameraError.value;
  const problemText = error ?? pumpError.value ?? cameraError.value;
  // The tilt sensor: asked once, on a card in the middle (M9 part 5). "Not now" leaves a small button under
  // the status capsule instead.
  const tiltWanted = live && (Boolean(free) || mode === 'detail') && levelPermission.value === 'unknown';
  const tiltCard = tiltWanted && !tiltLater;
  // The steadiness ring around the shutter fills while the phone is held still; only while photos take themselves.
  const fill = live && gauge && autoCapture && !busy ? Math.max(0, Math.min(1, gauge.steady)) : 0;
  const ring = 2 * Math.PI * 37;
  const refused = !live && Boolean(problemText && /refused|not allowed|denied/i.test(problemText));

  return (
    <div class="live table-camera" data-testid="table-camera" data-mode={mode} data-state={state}>
      <video ref={videoRef} playsInline muted autoPlay data-testid="live-video" />
      {live && <MarkerOverlay video={videoEl} />}
      {live && pieces && pieces.length > 0 && <PieceOverlay video={videoEl} pieces={pieces} />}

      {/* The level: a reticle in the middle with no panel behind it, so the view stays clear. */}
      {live && gauge && !tiltCard && (
        <div class="gauge-wrap">
          <LevelGauge state={gauge} lean={lean} tiltDeg={tilt} maxTiltDeg={maxTilt} arrow={gauge.targetDirImg} />
        </div>
      )}

      {/* Top: Back, the screen's own buttons (the scan's gear), zoom and 🧪; under them the status capsule
          with the one instruction (design plan §3.5 camera chrome). */}
      <div class="live-top cam-top">
        <div class="cam-top-row">
          <IconButton label="Back" class="btn-cam" testId="camera-close" onClick={onClose}>
            <Icon name="chevron-left" />
          </IconButton>
          {topExtra}
          <span class="cam-top-gap" />
          <span class="cam-zoom" role="img" aria-label={zoom >= 1.5 ? 'Zoom 2×' : 'Zoom 1×'} data-testid="camera-zoom">
            <span aria-hidden="true">{zoom >= 1.5 ? '2×' : '1×'}</span>
          </span>
          <TestButton variant="camera" />
        </div>
        <div class="cam-top-status">
          {live && !tiltCard && <CameraStatus state={gauge} tiltDeg={tilt} maxTiltDeg={maxTilt} />}
          {tiltWanted && tiltLater && (
            <button type="button" class="cam-hint cam-hint-button" data-testid="allow-tilt" onClick={() => void requestLevelSensor()}>
              <Icon name="compass" size={18} />
              Allow the tilt sensor
            </button>
          )}
          {live && free && levelPermission.value === 'denied' && <p class="cam-hint">Tilt sensor off: hold the phone as flat as you can</p>}
        </div>
      </div>

      {tiltCard && (
        <div class="cam-center">
          <div class="cam-card" role="group" aria-labelledby="tilt-card-title" data-testid="tilt-card">
            <span class="cam-card-icon" aria-hidden="true">
              <Icon name="compass" size={28} />
            </span>
            <h2 id="tilt-card-title">Allow the tilt sensor</h2>
            <p>
              {free
                ? 'It tells when the phone is flat, so photos take themselves at the right moment. Your iPhone asks once.'
                : 'It helps hold the phone flat when no marker is in view. Your iPhone asks once.'}
            </p>
            <button type="button" class="btn btn-filled btn-block" data-testid="allow-tilt" onClick={() => void requestLevelSensor()}>
              Allow
            </button>
            <button type="button" class="btn btn-plain btn-small cam-card-later" data-testid="tilt-later" onClick={() => setTiltLater(true)}>
              Not now
            </button>
          </div>
        </div>
      )}

      {/* With the camera off: one card in the middle and nothing over it; the top bar stays tappable. */}
      {!live && (
        <div class="cam-center">
          {state === 'starting' ? (
            <p class="cam-hint" role="status">
              Starting the camera…
            </p>
          ) : (
            <div
              class="cam-card"
              role="group"
              aria-labelledby="camera-off-title"
              data-testid={problem ? 'camera-problem' : state === 'paused' ? 'camera-paused' : 'camera-off'}
            >
              <span class="cam-card-icon" aria-hidden="true">
                <Icon name="camera" size={28} />
              </span>
              <h2 id="camera-off-title">
                {state === 'paused' ? 'Camera paused' : refused ? 'Allow the camera' : problem ? 'The camera is off' : 'Camera off'}
              </h2>
              {refused ? (
                <ol class="cam-card-steps">
                  <li>Tap Start camera below and choose Allow.</li>
                  <li>No question? On the iPhone: Settings › Apps › Safari › Camera › Allow.</li>
                  <li>Come back here and tap Start camera.</li>
                </ol>
              ) : problem ? (
                <p>{problemText}</p>
              ) : state === 'paused' ? (
                <p>The iPhone paused it (another app or the photo library used the camera).</p>
              ) : null}
              <button type="button" class="btn btn-filled btn-block" data-testid="start-camera" onClick={() => void startCamera()}>
                {state === 'paused' ? 'Resume camera' : 'Start camera'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bottom, from the top down: the screen's own panel (the scan's result), a photo that failed, the row
          above the dock (the scan's map and counts), and the dock: mode words, last photo, shutter, Photos. */}
      <div class="cam-bottom">
        {children && <div class="table-camera-panel">{children}</div>}
        {live && problem && (
          <p class="cam-problem" data-testid="camera-problem" role="alert">
            {problemText}
          </p>
        )}
        {above && <div class="cam-above">{above}</div>}
        <div class="cam-dock" data-testid="camera-dock">
          {modes && <div class="cam-modes">{modes}</div>}
          <div class="cam-dock-row">
            <div class="cam-slot">{dockLeft}</div>
            <button
              type="button"
              class="snap-btn"
              aria-label="Take the photo now"
              data-testid="snap"
              disabled={!live || snapBusy.value || Boolean(busy) || pumpMode.value === 'off'}
              onClick={() => void take(false)}
            >
              <svg class="snap-ring" viewBox="0 0 78 78" aria-hidden="true">
                <circle cx="39" cy="39" r="37" class="snap-ring-track" />
                <circle
                  cx="39"
                  cy="39"
                  r="37"
                  class="snap-ring-fill"
                  data-testid="snap-ring"
                  data-fill={fill.toFixed(2)}
                  style={{ strokeDasharray: `${ring}`, strokeDashoffset: `${ring * (1 - fill)}` }}
                  transform="rotate(-90 39 39)"
                />
              </svg>
              <span class="snap-disc" />
            </button>
            <div class="cam-slot">{dockRight}</div>
          </div>
        </div>
      </div>

      {(snapBusy.value || busy) && (
        <div class="live-center" style={{ pointerEvents: 'none' }}>
          <p class="chip" data-testid="camera-busy">
            {busy ?? 'Taking the photo…'}
          </p>
        </div>
      )}
    </div>
  );
}
