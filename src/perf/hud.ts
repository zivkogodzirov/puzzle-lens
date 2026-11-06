/**
 * Numbers for the performance HUD (PLAN §6 M1): frame rates, time per stage, memory, open
 * frames. Plain signals so the HUD component re-renders on change.
 */
import { signal } from '@preact/signals';
import type { StageTimings, TrackerFrameResult, WorkerMemory } from '../shared/types';

/** Exponential moving average helper. */
export class Ema {
  value: number | null = null;
  constructor(private readonly alpha = 0.1) {}
  add(x: number): number {
    this.value = this.value === null ? x : this.value + this.alpha * (x - this.value);
    return this.value;
  }
}

/** Counts events per second over a sliding window. */
export class RateMeter {
  private times: number[] = [];
  constructor(private readonly windowMs = 2000) {}
  tick(now = performance.now()): void {
    this.times.push(now);
    this.trim(now);
  }
  rate(now = performance.now()): number {
    this.trim(now);
    if (this.times.length < 2) return 0;
    const span = Math.max(now - this.times[0]!, 1);
    return ((this.times.length - 1) * 1000) / span;
  }
  private trim(now: number): void {
    while (this.times.length && now - this.times[0]! > this.windowMs) this.times.shift();
  }
}

export const hud = {
  videoFps: signal(0),
  trackerFps: signal(0),
  /** Smoothed milliseconds per tracker stage. */
  trackerStages: signal<StageTimings>({}),
  /** Longest pause between two tracker results in the last second, in ms (PLAN §6 M1 "gap between updates"). */
  resultGapMs: signal(0),
  markersSeen: signal(0),
  sharpness: signal(0),
  frameSource: signal<string>('—'),
  frameFormat: signal<string>('—'),
  frameSize: signal<string>('—'),
  trackerMemory: signal<WorkerMemory | null>(null),
  readerMemory: signal<WorkerMemory | null>(null),
  trackerSkipped: signal(0),
  /** How big frames are read and what each way cost, once the tracker has timed both. */
  bigFrames: signal<string>(''),
  /** A recent tracker error (cleared after a few seconds). */
  lastError: signal<string | null>(null),
};

const stageEmas = new Map<string, Ema>();
const trackerRate = new RateMeter();

export function recordTrackerResult(r: TrackerFrameResult): void {
  trackerRate.tick();
  const smoothed: StageTimings = {};
  for (const [k, v] of Object.entries(r.timings)) {
    let e = stageEmas.get(k);
    if (!e) stageEmas.set(k, (e = new Ema(0.15)));
    smoothed[k] = e.add(v);
  }
  hud.trackerStages.value = smoothed;
  hud.trackerFps.value = trackerRate.rate();
  hud.markersSeen.value = r.markers.length;
  hud.sharpness.value = r.sharpness;
  hud.frameSource.value = r.source === 'mstp' ? 'direct (worker)' : 'copied (fallback)';
  hud.frameFormat.value = r.format ?? 'unknown';
  hud.frameSize.value = `${r.width}×${r.height}`;
}

export function resetHud(): void {
  stageEmas.clear();
  hud.trackerFps.value = 0;
  hud.videoFps.value = 0;
  hud.trackerStages.value = {};
  hud.markersSeen.value = 0;
  hud.sharpness.value = 0;
  hud.resultGapMs.value = 0;
  hud.trackerSkipped.value = 0;
  hud.frameSource.value = '—';
  hud.frameFormat.value = '—';
  hud.frameSize.value = '—';
  hud.lastError.value = null;
}

export function mb(bytes: number | undefined | null): string {
  if (!bytes) return '0 MB';
  return `${Math.round(bytes / 1048576)} MB`;
}
