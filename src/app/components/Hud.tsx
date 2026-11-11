import { hud, mb } from '../../perf/hud';
import { cameraInfo } from '../../camera/camera';
import { pumpMode } from '../../camera/framePump';
import { wakeLockActive } from '../../camera/wakeLock';
import { Icon } from '../ui/icons';

const STAGE_LABELS: Record<string, string> = {
  read: 'read',
  copy: 'copy',
  scale: 'gpu-shrink',
  resize: 'shrink',
  markers: 'markers',
  sharpness: 'sharp',
  total: 'TOTAL',
};

/** Performance display (PLAN §6 M1): frame rates, ms per stage, memory, open frames. */
export function Hud() {
  const info = cameraInfo.value;
  const s = info?.settings;
  const stages = hud.trackerStages.value;
  const tm = hud.trackerMemory.value;
  const rm = hud.readerMemory.value;
  return (
    <div class="hud" data-testid="hud">
      <div>
        <b>camera</b> {s?.width ?? '?'}×{s?.height ?? '?'} @{s?.frameRate ? Math.round(s.frameRate) : '?'} {s?.zoom ? `zoom ${s.zoom}×` : ''}
      </div>
      <div>
        <b>video</b> {hud.videoFps.value.toFixed(1)} fps · <b>tracker</b> <span data-testid="tracker-fps">{hud.trackerFps.value.toFixed(1)}</span> fps
        {hud.trackerSkipped.value ? ` (skipped ${hud.trackerSkipped.value})` : ''}
      </div>
      <div>
        <b>frames</b> {pumpMode.value === 'off' ? 'not connected' : hud.frameSource.value} · {hud.frameFormat.value} · {hud.frameSize.value}
      </div>
      {hud.bigFrames.value && (
        <div data-testid="big-frames">
          <b>big frames</b> {hud.bigFrames.value}
        </div>
      )}
      <div>
        <b>ms</b>{' '}
        {Object.keys(STAGE_LABELS)
          .filter((k) => stages[k] !== undefined)
          .map((k) => `${STAGE_LABELS[k]} ${stages[k]!.toFixed(1)}`)
          .join(' · ') || '—'}
      </div>
      <div>
        <b>markers</b> <span data-testid="markers-seen">{hud.markersSeen.value}</span> · <b>sharpness</b> {Math.round(hud.sharpness.value)} · <b>gap</b>{' '}
        <span data-testid="result-gap">{Math.round(hud.resultGapMs.value)}</span> ms
      </div>
      <div>
        <b>memory</b> tracker {mb(tm?.wasmBytes)} (objects {tm?.liveScoped ?? 0}/{tm?.livePersistent ?? 0}, open frames {tm?.openFrames ?? 0})
        {rm ? ` · reader ${mb(rm.wasmBytes)}` : ''}
      </div>
      <div>
        <b>screen awake</b> {wakeLockActive.value ? 'yes' : 'no'}
      </div>
      {hud.lastError.value && (
        <div class="bad hud-error" data-testid="hud-error">
          <Icon name="alert-triangle" size={14} /> {hud.lastError.value}
        </div>
      )}
    </div>
  );
}
