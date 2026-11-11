import { useEffect, useRef, useState } from 'preact/hooks';
import { go } from '../router';
import { settings } from '../settings';
import { cameraDevices, cameraError, cameraInfo, cameraState, cameraStream, setTorch, setZoom, startCamera, stopCamera } from '../../camera/camera';
import { startPump, stopPump, pumpError, pumpMode } from '../../camera/framePump';
import { beginExternalCapture, cancelExternalCapture, canSnapWithCamera, lastSnap, snapBusy, snapFromFile, snapWithCamera } from '../../camera/snap';
import { resetHud } from '../../perf/hud';
import { Hud } from '../components/Hud';
import { MarkerOverlay } from '../components/MarkerOverlay';
import { SnapSheet } from '../components/SnapSheet';
import { TestButton } from '../components/TestSteps';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/icons';

export function LiveScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [showSheet, setShowSheet] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const externalOpenedAt = useRef(0);

  const state = cameraState.value;
  const stream = cameraStream.value;
  const info = cameraInfo.value;
  const zoomCap = info?.capabilities.zoom;
  const zoom = info?.settings.zoom ?? 1;

  // Attach the stream to the <video> and connect the tracker once it plays.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let onPlaying: (() => void) | null = null;
    if (stream && v.srcObject !== stream) {
      v.srcObject = stream;
      onPlaying = () => {
        resetHud();
        void startPump(v);
      };
      v.addEventListener('playing', onPlaying, { once: true });
      void v.play().catch(() => {});
    }
    if (!stream) {
      stopPump();
      v.srcObject = null;
    }
    setVideoEl(v);
    // A newer stream (or leaving the screen) must not start the pump for this one later.
    return () => {
      if (onPlaying) v.removeEventListener('playing', onPlaying);
    };
  }, [stream]);

  // Leaving the screen (any way, including Safari's back swipe) turns the camera off.
  useEffect(
    () => () => {
      try {
        stopPump();
      } finally {
        stopCamera();
      }
    },
    [],
  );

  /** Opens the iPhone's own camera screen. Must run synchronously inside a tap, or iOS ignores it. */
  const openSystemCamera = () => {
    externalOpenedAt.current = beginExternalCapture();
    fileRef.current?.click();
  };

  const onSnap = () => {
    if (snapBusy.value) return;
    if (canSnapWithCamera()) {
      void snapWithCamera(videoRef.current).then(() => setShowSheet(true));
    } else {
      openSystemCamera();
    }
  };

  const onFile = (ev: Event) => {
    const input = ev.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      cancelExternalCapture();
      return;
    }
    void snapFromFile(file, externalOpenedAt.current).then(() => setShowSheet(true));
  };

  const live = state === 'live';
  const can2x = Boolean(zoomCap && zoomCap.max >= 2);

  return (
    // M9 part 6 help: the screen's main landmark, with a heading (the title beside Back shows the camera's state).
    <main class="live">
      <h1 class="sr-only">Live camera</h1>
      <video ref={videoRef} playsInline muted autoPlay data-testid="live-video" />
      {live && <MarkerOverlay video={videoEl} />}

      <div class="live-top">
        <IconButton
          label="Back to Home"
          class="btn-cam"
          testId="live-home"
          onClick={() => {
            stopCamera();
            go('home');
          }}
        >
          <Icon name="chevron-left" />
        </IconButton>
        <span class="title">
          {state === 'live' ? (pumpMode.value === 'off' ? 'Connecting…' : 'Live') : state === 'starting' ? 'Starting camera…' : 'Camera'}
        </span>
        {cameraDevices.value.length > 1 && (live || state === 'error') && (
          <select
            aria-label="Camera lens"
            data-testid="lens-select"
            style={{ width: 'auto', maxWidth: '40vw', minHeight: '40px', background: 'var(--cam-scrim)', color: 'var(--white)' }}
            value={settings.cameraDeviceId.value}
            onChange={(e) => {
              const id = (e.currentTarget as HTMLSelectElement).value;
              settings.cameraDeviceId.value = id;
              void startCamera(id ? { deviceId: id } : {});
            }}
          >
            <option value="">Automatic (recommended)</option>
            {cameraDevices.value.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Camera'}
              </option>
            ))}
          </select>
        )}
        {settings.testerMode.value && (
          <IconButton
            label="Performance display"
            class="btn-cam"
            testId="hud-toggle"
            aria-pressed={settings.showHud.value}
            onClick={() => (settings.showHud.value = !settings.showHud.value)}
          >
            <Icon name="activity" />
          </IconButton>
        )}
        <TestButton variant="camera" />
      </div>

      {live && settings.testerMode.value && settings.showHud.value && <Hud />}

      {live && pumpError.value && (
        <div class="notice notice-bad live-notice" data-testid="pump-error">
          <p>{pumpError.value}</p>
          <button
            class="btn btn-small"
            onClick={() => {
              const v = videoRef.current;
              if (v) void startPump(v);
            }}
          >
            Try again
          </button>
        </div>
      )}

      {!live && (
        <div class="live-center">
          {state === 'starting' ? (
            <p>Starting the camera…</p>
          ) : (
            <>
              <p style={{ maxWidth: '420px' }}>
                {state === 'paused'
                  ? 'The camera was paused by your iPhone.'
                  : 'Point the camera straight down at your table. iPhone will ask for camera permission.'}
              </p>
              {cameraError.value && <p class="bad">{cameraError.value}</p>}
              <button class="btn btn-filled" data-testid="start-camera" onClick={() => void startCamera()}>
                {state === 'paused' ? 'Resume camera' : 'Start camera'}
              </button>
            </>
          )}
        </div>
      )}

      <div class="live-bottom">
        <div class="row">
          {live && can2x && (
            <>
              <button class="chip" aria-pressed={zoom < 1.5} onClick={() => void setZoom(1)}>
                1×
              </button>
              <button class="chip" aria-pressed={zoom >= 1.5} onClick={() => void setZoom(2)}>
                2×
              </button>
            </>
          )}
          {live && info?.capabilities.torch && (
            <IconButton
              label="Light"
              class="btn-cam"
              testId="torch"
              aria-pressed={torchOn}
              onClick={() => {
                const on = !torchOn;
                setTorchOn(on);
                void setTorch(on);
              }}
            >
              <Icon name="flashlight" />
            </IconButton>
          )}
        </div>
        <button class="snap-btn" aria-label="Snap a full-resolution photo" data-testid="snap" disabled={snapBusy.value} onClick={onSnap} />
        <div class="row">
          {lastSnap.value && (
            <button class="chip" onClick={() => setShowSheet(true)}>
              Last photo
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        class="hidden-input"
        tabIndex={-1}
        aria-hidden="true"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
        onCancel={() => cancelExternalCapture()}
      />

      {snapBusy.value && (
        <div class="live-center" style={{ pointerEvents: 'none' }}>
          <p class="chip">Taking and checking the photo…</p>
        </div>
      )}
      {showSheet && lastSnap.value && (
        <SnapSheet
          record={lastSnap.value}
          onClose={() => setShowSheet(false)}
          onUseSystemCamera={() => {
            setShowSheet(false);
            openSystemCamera();
          }}
        />
      )}
    </main>
  );
}
