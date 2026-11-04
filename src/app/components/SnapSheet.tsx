import type { SnapRecord } from '../../camera/snap';
import { mb } from '../../perf/hud';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Result of the last Snap: photo, size, how it was taken, and a quick quality check. */
export function SnapSheet({ record, onClose, onUseSystemCamera }: { record: SnapRecord; onClose: () => void; onUseSystemCamera?: () => void }) {
  const { snap, stats, previewUrl, error, saveWarning, cameraFailed } = record;
  const mp = stats ? (stats.width * stats.height) / 1e6 : 0;
  return (
    <div class="sheet" data-testid="snap-sheet">
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Last photo</h2>
        <button class="btn btn-small" onClick={onClose}>
          Close
        </button>
      </div>
      {error && (
        <p class="bad" data-testid="snap-error">
          {error}
        </p>
      )}
      {cameraFailed && onUseSystemCamera && (
        <button class="btn btn-primary" data-testid="use-system-camera" onClick={onUseSystemCamera}>
          Use the iPhone camera instead
        </button>
      )}
      {saveWarning && (
        <p class="notice notice-warn small" data-testid="snap-save-warning">
          {saveWarning}
        </p>
      )}
      {previewUrl && <img src={previewUrl} alt="Last photo" />}
      {stats && (
        <dl class="kv" style={{ marginTop: '12px' }}>
          <dt>Size</dt>
          <dd data-testid="snap-size">
            {stats.width} × {stats.height} ({mp.toFixed(1)} MP)
          </dd>
          <dt>Taken with</dt>
          <dd>{snap.method === 'takePhoto' ? 'the app (ImageCapture)' : "iPhone's camera screen"}</dd>
          {snap.requested && (
            <>
              <dt>Asked for</dt>
              <dd>
                {snap.requested.imageWidth} × {snap.requested.imageHeight}
              </dd>
            </>
          )}
          <dt>Time to take</dt>
          <dd>{(snap.ms / 1000).toFixed(1)} s</dd>
          <dt>Camera paused</dt>
          <dd>
            {Math.round(snap.mutedMs)} ms{snap.workerGapMs != null ? ` (longest gap in live frames: ${Math.round(snap.workerGapMs)} ms)` : ''}
          </dd>
          <dt>File</dt>
          <dd>
            {Math.round(snap.bytes / 1024)} KB {snap.type}
          </dd>
          <dt>Brightness</dt>
          <dd>{Math.round(stats.meanLuma)} / 255</dd>
          <dt>Blown-out / black</dt>
          <dd>
            {pct(stats.clippedHigh)} / {pct(stats.clippedLow)}
          </dd>
          <dt>Sharpness</dt>
          <dd>{Math.round(stats.sharpness)}</dd>
          <dt>Checked in</dt>
          <dd>
            {Math.round(stats.decodeMs)} ms decode + {Math.round(stats.analyseMs)} ms check ({stats.tiles} tiles, {stats.readMethod})
          </dd>
          <dt>Reader memory</dt>
          <dd>{mb(stats.wasmBytesAfter)}</dd>
        </dl>
      )}
    </div>
  );
}
