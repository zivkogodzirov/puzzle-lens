/**
 * Pure helpers for the Device check: status symbols, number formatting, turning raw probe
 * results into plain-English rows, merging runs. No DOM access, so all of it is unit-tested.
 */
import type { CheckEntry, CheckStatus, DeviceCheckResults, DeviceEnvironment, DisplayMode, RunPart, SectionId } from './types';
import { CHECK_ORDER, SECTIONS, makeEntry } from './catalog';
import type { GpuProbeResult, NoiseComparison } from '../shared/probeApi';
import type { CvBenchResult, TwoXResult } from '../shared/types';

/* ---------- statuses ---------- */

const SYMBOL: Record<CheckStatus, string> = { yes: '✓', no: '✗', partial: '~', error: '⚠', skipped: '–', info: 'ⓘ' };
const CLASS: Record<CheckStatus, string> = { yes: 'ok', no: 'bad', partial: 'warn', error: 'bad', skipped: 'muted', info: 'muted' };
const WORD: Record<CheckStatus, string> = { yes: 'Yes', no: 'No', partial: 'Partly', error: 'Test failed', skipped: 'Not run', info: 'Normal on iPhone' };
/** Words for the summary line, so it never relies on the symbols alone. */
const SUMMARY_WORD: Record<CheckStatus, string> = {
  yes: 'working',
  partial: 'limited',
  no: 'not available',
  error: 'test failed',
  info: 'normal on iPhone',
  skipped: 'not run',
};
const SUMMARY_ORDER: CheckStatus[] = ['yes', 'partial', 'no', 'error', 'info', 'skipped'];

export const statusSymbol = (s: CheckStatus): string => SYMBOL[s] ?? '?';
export const statusClass = (s: CheckStatus): string => CLASS[s] ?? '';
export const statusWord = (s: CheckStatus): string => WORD[s] ?? s;

/** The note added to rows that show a known iPhone limit or an expected state. */
export const NORMAL_NOTE = 'Normal on iPhone — nothing to do';

export function modeLabel(mode: DisplayMode): string {
  return mode === 'standalone' ? 'Home Screen app' : 'Safari tab';
}

/* ---------- numbers ---------- */

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function formatMB(mb: number): string {
  return `${Math.round(mb).toLocaleString('en-US')} MB`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function megapixels(w: number, h: number): number {
  return Math.round((w * h) / 1e5) / 10;
}

export function sizeText(w: number, h: number): string {
  return `${w}×${h} (${megapixels(w, h).toFixed(1)} MP)`;
}

/* ---------- user agent ---------- */

/** Safari's own version ("Version/27.2"), or null. */
export function parseSafariVersion(ua: string): string | null {
  return /Version\/(\d+(?:\.\d+){0,2})/.exec(ua)?.[1] ?? null;
}

/** The iOS version written in the user agent ("OS 18_6 like Mac OS X" → "18.6"). Safari 26+ may freeze it. */
export function parseIosVersion(ua: string): string | null {
  const m = /(?:iPhone|CPU) OS (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(ua);
  return m ? [m[1], m[2], m[3]].filter(Boolean).join('.') : null;
}

/* ---------- video frame rate ---------- */

export interface FpsSample {
  /** Callback time (ms). */
  t: number;
  /** requestVideoFrameCallback metadata.presentedFrames, when available. */
  presented?: number | null;
}

/** Frames per second from requestVideoFrameCallback samples (uses presentedFrames when available, so skipped callbacks don't count against the camera). */
export function fpsFromSamples(samples: FpsSample[]): { fps: number; frames: number; spanMs: number } | null {
  if (samples.length < 2) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const spanMs = last.t - first.t;
  if (spanMs <= 0) return null;
  const counted = first.presented != null && last.presented != null && last.presented > first.presented ? last.presented - first.presented : samples.length - 1;
  return { fps: (counted * 1000) / spanMs, frames: counted, spanMs };
}

/* ---------- camera permission history (WebKit bug 327237) ---------- */

export interface LaunchLike {
  ts: number;
  mode: DisplayMode;
  cameraPermission: string;
}

export interface PermissionCounts {
  total: number;
  prompt: number;
  granted: number;
  denied: number;
  other: number;
}

export function summarizeLaunches(rows: LaunchLike[]): Record<DisplayMode, PermissionCounts> {
  const blank = (): PermissionCounts => ({ total: 0, prompt: 0, granted: 0, denied: 0, other: 0 });
  const out: Record<DisplayMode, PermissionCounts> = { standalone: blank(), browser: blank() };
  for (const r of rows) {
    const c = out[r.mode === 'standalone' ? 'standalone' : 'browser'];
    c.total++;
    if (r.cameraPermission === 'prompt') c.prompt++;
    else if (r.cameraPermission === 'granted') c.granted++;
    else if (r.cameraPermission === 'denied') c.denied++;
    else c.other++;
  }
  return out;
}

export function permissionWord(state: string): string {
  switch (state) {
    case 'granted':
      return 'Allowed';
    case 'prompt':
      return 'Will ask';
    case 'denied':
      return 'Blocked';
    default:
      return "Can't tell";
  }
}

/** How often the Home Screen app had to ask for the camera again at launch. */
export function permissionHistoryEntry(rows: LaunchLike[]): CheckEntry {
  const sum = summarizeLaunches(rows);
  const s = sum.standalone;
  const recent = rows
    .filter((r) => r.mode === 'standalone')
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 15)
    .map((r) => ({ ts: r.ts, permission: r.cameraPermission }));
  const details = { standalone: s, browser: sum.browser, recentHomeScreenLaunches: recent };
  if (s.total === 0) return makeEntry('camera-permission-history', 'skipped', 'No Home Screen launches yet', details);
  const known = s.total - s.other;
  if (known === 0) return makeEntry('camera-permission-history', 'skipped', `Can't tell (${s.total} launches)`, details);
  const value = `Asked again at ${s.prompt} of ${known} launches`;
  // The very first launch always asks, so one "prompt" is expected.
  return makeEntry('camera-permission-history', s.prompt > 1 ? 'partial' : 'yes', value, details);
}

/* ---------- verdicts for individual probes ---------- */

/**
 * The 2× lens test is measured but NOT judged yet: the detail measure can't yet tell a real 2× lens
 * from digital zoom reliably (a real 2× crop scored at or below the old "digital zoom" threshold in
 * the synthetic tests). So it never gives a ✗ or a recommendation; the raw ratio goes into the report
 * and the thresholds will be set from measurements on the owner's iPhone. `r.verdict` is ignored.
 */
export function twoXVerdict(r: TwoXResult): { status: CheckStatus; value: string } {
  const ratio = Number.isFinite(r.ratio) ? r.ratio.toFixed(2) : '?';
  return { status: 'partial', value: `Measured ratio ${ratio} — not judged yet; the developer will set the thresholds from your phone's report` };
}

export function noiseVerdict(cmp: NoiseComparison | null, error?: string): { status: CheckStatus; value: string } {
  if (!cmp) return { status: 'error', value: error ?? 'Could not read pixels back' };
  if (cmp.verdict === 'clean') return { status: 'yes', value: 'No noise' };
  if (cmp.verdict === 'noise') return { status: 'partial', value: 'Noise detected (Safari fingerprinting protection)' };
  return { status: 'partial', value: 'Small differences in a gradient (possibly noise)' };
}

/** PLAN §8: the tracker has ≤ 25 ms per live frame. */
export const LIVE_FRAME_BUDGET_MS = 25;

export function benchSummary(bench: CvBenchResult): { status: CheckStatus; value: string } {
  const live = bench.stages.find((s) => /^live frame/i.test(s.name));
  const total = bench.stages.reduce((a, s) => a + s.ms, 0);
  if (!bench.stages.length) return { status: 'error', value: 'No timings' };
  const parts = [`${bench.stages.length} steps in ${formatMs(total)}`];
  if (live) parts.unshift(`live frame ${formatMs(live.ms)}`);
  const value = parts.join(' · ');
  if (live && live.ms > LIVE_FRAME_BUDGET_MS) return { status: 'partial', value: `${value} (slower than the ${LIVE_FRAME_BUDGET_MS} ms target)` };
  return { status: 'yes', value };
}

/** A photo with an explicit size is "yes" only if that size came back (either orientation). */
export function photoStatus(requested: { imageWidth?: number; imageHeight?: number } | null | undefined, w: number, h: number): CheckStatus {
  if (!requested?.imageWidth || !requested.imageHeight) return 'yes';
  const wantLong = Math.max(requested.imageWidth, requested.imageHeight);
  const wantShort = Math.min(requested.imageWidth, requested.imageHeight);
  return Math.max(w, h) === wantLong && Math.min(w, h) === wantShort ? 'yes' : 'partial';
}

function mb(bytes: number | undefined): string {
  return bytes == null ? '?' : `${Math.round(bytes / 1048576)} MB`;
}

/** Rows for the WebGPU part, from the main-thread probe and (if it ran) the worker probe. */
export function gpuEntries(main: GpuProbeResult, worker: GpuProbeResult | null, workerError?: string): CheckEntry[] {
  const out: CheckEntry[] = [];
  const summary = (r: GpuProbeResult | null) =>
    r && { available: r.available, adapter: r.adapter, adapterTimedOut: r.adapterTimedOut, adapterMs: Math.round(r.adapterMs), device: r.device, error: r.error, deviceError: r.deviceError, deviceLost: r.deviceLost };
  const where = { main: summary(main), worker: summary(worker) ?? (workerError ? { error: workerError } : null) };

  if (!main.available) out.push(makeEntry('webgpu-adapter', 'no', 'Not available here', where));
  else if (main.adapterTimedOut) out.push(makeEntry('webgpu-adapter', 'no', 'No answer within 3 s', where));
  else if (main.error && !main.adapter) out.push(makeEntry('webgpu-adapter', 'error', main.error, where));
  else if (!main.adapter) out.push(makeEntry('webgpu-adapter', 'no', 'No graphics adapter offered', where));
  else {
    const name = [main.info?.vendor, main.info?.architecture].filter((x) => typeof x === 'string' && x).join(' · ');
    out.push(makeEntry('webgpu-adapter', 'yes', name || 'Found', { ...where, info: main.info, features: main.features }));
  }

  if (main.limits) {
    const l = main.limits;
    const value = `buffer ${mb(l.maxBufferSize)} · storage ${mb(l.maxStorageBufferBindingSize)} · group memory ${Math.round((l.maxComputeWorkgroupStorageSize ?? 0) / 1024)} KB · ${l.maxComputeInvocationsPerWorkgroup ?? '?'} threads`;
    out.push(makeEntry('webgpu-limits', 'yes', value, l));
  } else out.push(makeEntry('webgpu-limits', 'skipped', 'No graphics adapter'));

  if (!main.adapter) out.push(makeEntry('webgpu-f16', 'skipped', 'No graphics adapter'));
  else if (main.f16 && main.f16Enabled) out.push(makeEntry('webgpu-f16', 'yes', 'Yes'));
  else if (main.f16) out.push(makeEntry('webgpu-f16', 'partial', 'Listed, but could not be switched on', { deviceError: main.deviceError }));
  else out.push(makeEntry('webgpu-f16', 'no', 'No'));

  if (!main.adapter) out.push(makeEntry('webgpu-device', 'skipped', 'No graphics adapter'));
  else if (main.device) out.push(makeEntry('webgpu-device', 'yes', 'Ready', { deviceLost: main.deviceLost }));
  else out.push(makeEntry('webgpu-device', 'error', main.deviceError ?? main.error ?? 'Could not start', where));

  const compute = (id: string, r: GpuProbeResult | null, missing?: string) => {
    if (!r) return makeEntry(id, 'error', missing ?? 'Did not run');
    if (!r.device || !r.compute) {
      if (r.error) return makeEntry(id, 'error', r.error, summary(r));
      return makeEntry(id, r.available ? 'skipped' : 'no', r.available ? 'Graphics chip not ready' : 'No WebGPU here', summary(r));
    }
    const c = r.compute;
    if (c.error) return makeEntry(id, 'error', c.error, c);
    if (c.wrong > 0) return makeEntry(id, 'error', `Wrong results (${c.wrong} of ${c.checked} checked)`, c);
    const speed = c.gflops >= 1 ? `${Math.round(c.gflops)} GFLOP/s` : `${c.gflops.toFixed(2)} GFLOP/s`;
    return makeEntry(id, c.ok ? 'yes' : 'partial', `Correct · ${formatMs(c.msPerRun)} per ${c.n}×${c.n} multiply (${speed})`, c);
  };
  out.push(compute('webgpu-compute-main', main));
  out.push(compute('webgpu-compute-worker', worker, workerError));
  return out;
}

/* ---------- results ---------- */

const ORDER = new Map(CHECK_ORDER.map((id, i) => [id, i]));

/** Replaces rows with the same id, adds new ones, and sorts into display order. */
export function mergeChecks(base: CheckEntry[], add: CheckEntry[]): CheckEntry[] {
  const map = new Map<string, CheckEntry>();
  for (const c of base) map.set(c.id, c);
  for (const c of add) map.set(c.id, c);
  const list = [...map.values()];
  const rank = (c: CheckEntry) => ORDER.get(c.id) ?? Number.MAX_SAFE_INTEGER;
  return list.map((c, i) => ({ c, i })).sort((x, y) => rank(x.c) - rank(y.c) || x.i - y.i).map((x) => x.c);
}

export function groupBySection(checks: CheckEntry[]): Array<{ id: SectionId; title: string; checks: CheckEntry[] }> {
  return SECTIONS.map((s) => ({ id: s.id, title: s.title, checks: checks.filter((c) => c.section === s.id) })).filter((s) => s.checks.length > 0);
}

export function countByStatus(checks: CheckEntry[]): Record<CheckStatus, number> {
  const out: Record<CheckStatus, number> = { yes: 0, no: 0, partial: 0, error: 0, skipped: 0, info: 0 };
  for (const c of checks) out[c.status] = (out[c.status] ?? 0) + 1;
  return out;
}

/** "35 checks: 30 working, 3 limited, 2 normal on iPhone" — counts spelled out in words. */
export function summaryLine(checks: CheckEntry[]): string {
  const n = countByStatus(checks);
  const parts = SUMMARY_ORDER.filter((s) => n[s] > 0).map((s) => `${n[s]} ${SUMMARY_WORD[s]}`);
  return `${checks.length} check${checks.length === 1 ? '' : 's'}: ${parts.join(', ')}`;
}

/**
 * One plain sentence for the top of the results. "No" and "test failed" rows are the ones that need
 * a look; "limited" rows are mentioned but don't count as problems.
 */
export function verdictLine(checks: CheckEntry[]): { tone: 'good' | 'warn' | 'bad'; text: string } {
  if (!checks.length) return { tone: 'warn', text: 'No results yet.' };
  const problems = checks.filter((c) => c.status === 'no' || c.status === 'error');
  const limited = checks.filter((c) => c.status === 'partial');
  if (problems.length) {
    const names = problems.slice(0, 3).map((c) => c.label);
    const more = problems.length > 3 ? ` and ${problems.length - 3} more` : '';
    const what = problems.length === 1 ? '1 thing needs attention' : `${problems.length} things need attention`;
    return { tone: 'bad', text: `${what}: ${names.join(', ')}${more}. Nothing for you to fix — just send a report.` };
  }
  if (limited.length) {
    return {
      tone: 'warn',
      text: `Everything Puzzle Lens needs works. ${limited.length === 1 ? '1 thing works' : `${limited.length} things work`} with limits (marked ~).`,
    };
  }
  return { tone: 'good', text: 'Everything Puzzle Lens needs works.' };
}

export function isDeviceCheckResults(x: unknown): x is DeviceCheckResults {
  if (!x || typeof x !== 'object') return false;
  const r = x as Partial<DeviceCheckResults>;
  return r.schema === 1 && Array.isArray(r.checks) && typeof r.ts === 'number' && (r.mode === 'standalone' || r.mode === 'browser');
}

export function newResults(appVersion: string, mode: DisplayMode, environment: DeviceEnvironment, ts: number): DeviceCheckResults {
  return { schema: 1, appVersion, ts, mode, environment, checks: [], parts: {} };
}

/**
 * Adds one run's rows to the results (a new object; the old one is untouched). New rows are tagged
 * with the app version that measured them (the results' own version unless given).
 */
export function applyRun(
  base: DeviceCheckResults,
  entries: CheckEntry[],
  part: RunPart | null,
  ts: number,
  environment?: DeviceEnvironment,
): DeviceCheckResults {
  const tagged = entries.map((e) => (e.appVersion ? e : { ...e, appVersion: base.appVersion }));
  return {
    ...base,
    ts,
    environment: environment ?? base.environment,
    checks: mergeChecks(base.checks, tagged),
    parts: part ? { ...base.parts, [part]: ts } : { ...base.parts },
  };
}

/**
 * Keeps earlier results after an app update instead of dropping them: every row keeps (or gets) the
 * version it was measured with, and the results move to the new version. Same version: unchanged.
 */
export function carryForward(results: DeviceCheckResults, appVersion: string): DeviceCheckResults {
  if (results.appVersion === appVersion) return results;
  return {
    ...results,
    appVersion,
    checks: results.checks.map((c) => (c.appVersion ? c : { ...c, appVersion: results.appVersion })),
  };
}

/** True if this row was measured with an older app version than the results it sits in. */
export function isFromOlderVersion(c: CheckEntry, results: { appVersion: string }): boolean {
  return Boolean(c.appVersion && c.appVersion !== results.appVersion);
}

/* ---------- the steps of a full check ---------- */

/** The steps that make a full check (the memory test is optional). */
export const REQUIRED_PARTS: readonly RunPart[] = ['automatic', 'camera', 'fileCamera'];

export const PART_NAMES: Record<RunPart, string> = {
  automatic: 'Automatic checks',
  camera: 'Camera tests',
  fileCamera: 'iPhone camera screen',
  memory: 'Memory test (optional)',
};

/**
 * Whether a step has been done: it ran to the end, and (for the camera steps) produced at least one
 * real measurement rather than only errors (e.g. camera permission refused).
 */
export function partDone(results: DeviceCheckResults | null | undefined, part: RunPart): boolean {
  if (!results?.parts[part]) return false;
  if (part === 'camera') return results.checks.some((c) => c.id.startsWith('camera-format-') && c.status !== 'error');
  if (part === 'fileCamera') return results.checks.some((c) => c.id === 'file-camera' && c.status !== 'error');
  if (part === 'memory') return results.checks.some((c) => c.id === 'memory-headroom');
  return true;
}

/** Required steps not done yet, in order. */
export function missingParts(results: DeviceCheckResults | null | undefined): RunPart[] {
  return REQUIRED_PARTS.filter((p) => !partDone(results, p));
}
