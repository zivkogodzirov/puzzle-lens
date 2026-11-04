/**
 * "Send report" (BRIEF §11, PLAN §5): gathers everything a report needs into a list of files for
 * the report worker, which zips them (images stored as they are, not re-compressed).
 *
 * The file is prepared BEFORE the "Share" tap: iOS only opens the share sheet within ~5 s of a
 * tap (RESEARCH §3, §14). Nothing here sends anything anywhere; the zip only leaves the phone if
 * the user shares it.
 *
 * Every part is collected separately: if one part fails (a worker that doesn't answer, a photo that
 * can't be read), the report is still made and the problem is written into it.
 */
import type { Signal } from '@preact/signals';
import { db, type BlobRow, type DeviceCheckRow, type DisplayMode, type LaunchRow, type LogRow } from '../db/db';
import { flushLogs, logInfo, recentLogs } from '../log/logger';
import { settingsSnapshot } from '../app/settings';
import { APP_VERSION, displayMode, previousEndedUnexpectedly } from '../app/env';
import { peekReader, peekTracker, readerInfo, reportWorker, trackerInfo } from '../app/workers';
import { cameraDevices, cameraError, cameraInfo, cameraState } from '../camera/camera';
import { hud } from '../perf/hud';
import type { ReportFileInput } from '../shared/apis';
import type { TrackerStatus, WorkerMemory } from '../shared/types';

/** Version of the report.json layout. */
export const REPORT_FORMAT = 1;
export const LOG_LIMIT = 1000;
export const LAUNCH_LIMIT = 20;
/** How long a worker gets to answer a question before the report goes on without it. */
const WORKER_TIMEOUT_MS = 2000;
/** Generous: a full-size photo is a few MB, and the phone may be busy. */
const BUILD_TIMEOUT_MS = 90_000;

export const README_NAME = 'README.txt';
export const REPORT_JSON_NAME = 'report.json';

/** The steps shown on screen while a report is prepared (the last one is the zipping). */
export const REPORT_STEPS = [
  'Saving the activity log',
  'Reading the Device check results',
  'Asking the camera helper how it is doing',
  'Collecting the photos',
  'Packing everything into one file',
] as const;

export interface CollectOptions {
  /** Add the last Snap at full size (several MB). */
  includeFullPhoto: boolean;
  /** Called at the start of each step; `step` counts from 1 to `total`. */
  onProgress?: (label: string, step: number, total: number) => void;
  /** The report's time (tests pass a fixed one). */
  now?: Date;
  /** Per-question limit for the workers (tests use a short one). */
  workerTimeoutMs?: number;
}

export interface ReportSummary {
  frames: number;
  hasPreview: boolean;
  hasFullPhoto: boolean;
  logCount: number;
  /** Parts that could not be collected (also written into report.json). */
  problems: string[];
}

export interface CollectedReport {
  fileName: string;
  createdAt: Date;
  /** Input for reportWorker().build(): README.txt and report.json first, then the images. */
  files: ReportFileInput[];
  summary: ReportSummary;
}

export interface PreparedReport extends CollectedReport {
  file: File;
}

export interface LatestDeviceChecks {
  standalone: DeviceCheckRow | null;
  browser: DeviceCheckRow | null;
}

/* ------------------------------------------------------------------------------------------- */
/* Pure helpers (unit-tested)                                                                  */
/* ------------------------------------------------------------------------------------------- */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "puzzle-lens-report-2026-11-04-1432.zip", in the phone's local time. */
export function reportFileName(d: Date): string {
  return `puzzle-lens-report-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.zip`;
}

/** "830 bytes", "412 KB", "3.4 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** File extension for an image type; JPEG unless the type says otherwise (e.g. HEIC from the Photos library). */
export function imageExtension(type: string): string {
  const t = type.toLowerCase();
  if (t === 'image/png') return 'png';
  if (t === 'image/heic' || t === 'image/heif') return 'heic';
  if (t === 'image/webp') return 'webp';
  return 'jpg';
}

function keepIfNewer(best: LatestDeviceChecks, row: DeviceCheckRow): void {
  if (row.mode !== 'standalone' && row.mode !== 'browser') return;
  const current = best[row.mode];
  if (!current || row.ts > current.ts || (row.ts === current.ts && (row.id ?? 0) > (current.id ?? 0))) best[row.mode] = row;
}

/** The newest Device check for the Home Screen app and for the Safari tab (rows in any order). */
export function latestPerMode(rows: Iterable<DeviceCheckRow>): LatestDeviceChecks {
  const best: LatestDeviceChecks = { standalone: null, browser: null };
  for (const row of rows) keepIfNewer(best, row);
  return best;
}

/**
 * Log rows from the database plus in-memory rows that aren't in it yet (e.g. a save that failed),
 * oldest first, at most `limit` (the newest are kept). Rows are matched by time, level, source and
 * message, counting duplicates, so two identical lines are never merged into one.
 */
export function mergeLogs(stored: LogRow[], memory: LogRow[], limit = LOG_LIMIT): LogRow[] {
  const key = (r: LogRow) => `${r.ts}|${r.level}|${r.source}|${r.message}`;
  const counts = new Map<string, number>();
  for (const r of stored) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  const merged = [...stored];
  for (const r of memory) {
    const n = counts.get(key(r)) ?? 0;
    if (n > 0) counts.set(key(r), n - 1);
    else merged.push(r);
  }
  const order = (r: LogRow) => r.id ?? Number.MAX_SAFE_INTEGER;
  merged.sort((a, b) => a.ts - b.ts || order(a) - order(b));
  return merged.slice(-limit);
}

export interface ReadmeInfo {
  created: Date;
  appVersion: string;
  mode: DisplayMode;
  logCount: number;
  frameNames: string[];
  previewName: string | null;
  fullPhotoName: string | null;
}

export function modeLabel(mode: DisplayMode): string {
  return mode === 'standalone' ? 'Home Screen app' : 'Safari tab';
}

/** The plain-English note at the top of the zip. */
export function reportReadme(info: ReadmeInfo): string {
  const lines: string[] = [
    'PUZZLE LENS REPORT',
    '==================',
    '',
    `Made on:     ${info.created.toLocaleString()}`,
    `App version: ${info.appVersion}`,
    `Running as:  ${modeLabel(info.mode)}`,
    '',
    'WHAT THIS IS',
    'A snapshot of how Puzzle Lens was working on your iPhone when you made it. It helps find and fix problems.',
    '',
    'YOUR PRIVACY',
    'Nothing has been sent anywhere. Puzzle Lens has no server and no account, and it never uploads anything by itself.',
    'This file only leaves your iPhone if you share it yourself (for example with AirDrop, Mail or Messages).',
    'The pictures in it show only what your camera was pointed at. If something private was in view, delete this file instead of sharing it.',
    '',
    "WHAT'S INSIDE",
    `- ${README_NAME}: this note.`,
    `- ${REPORT_JSON_NAME}: the technical details (for the developer): app version and settings, what your iPhone can do ` +
      `(your latest Device check in the ${modeLabel(info.mode)}), the last times the app was opened, ` +
      `the activity and error log (${info.logCount} entries), speed and memory numbers, camera details and storage use.`,
    `  The Safari tab and the Home Screen app keep separate data, so this report only has the ${modeLabel(info.mode)} results. ` +
      `Send another report from the ${modeLabel(info.mode === 'standalone' ? 'browser' : 'standalone')}.`,
  ];
  if (info.frameNames.length) {
    const folder = info.frameNames[0]!.split('/')[0];
    lines.push(
      `- ${folder}/: ${info.frameNames.length} small picture${info.frameNames.length === 1 ? '' : 's'} from the live camera, taken a few seconds apart ` +
        '(number 1 is the oldest).',
    );
  } else {
    lines.push('- No pictures from the live camera (the camera was not running).');
  }
  if (info.previewName) lines.push(`- ${info.previewName}: a small copy of your last photo (Snap).`);
  if (info.fullPhotoName) lines.push(`- ${info.fullPhotoName}: your last photo at full size (you chose to include it).`);
  if (!info.previewName && !info.fullPhotoName) lines.push('- No photo: none has been taken yet.');
  lines.push('');
  return lines.join('\n');
}

/** Makes report data safe for JSON: blobs, typed arrays, maps, errors and big numbers become readable values. */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (typeof Blob !== 'undefined' && value instanceof Blob) return { blob: value.type || 'unknown type', bytes: value.size };
  if (value instanceof ArrayBuffer) return { arrayBufferBytes: value.byteLength };
  if (ArrayBuffer.isView(value)) return { typedArray: value.constructor.name, bytes: value.byteLength };
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

/** report.json text. If one part can't be written (e.g. a loop), only that part is replaced by a note. */
export function toReportJson(report: Record<string, unknown>): string {
  try {
    return JSON.stringify(report, jsonReplacer, 2);
  } catch {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(report)) {
      try {
        out[k] = JSON.parse(JSON.stringify(v, jsonReplacer) ?? 'null');
      } catch (err) {
        out[k] = { couldNotBeSaved: errorText(err) };
      }
    }
    return JSON.stringify(out, null, 2);
  }
}

export function errorText(err: unknown): string {
  if (err instanceof Error || (typeof err === 'object' && err !== null && 'message' in err)) {
    const e = err as { name?: string; message?: string };
    return e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : String(e.message);
  }
  return String(err);
}

/** Rejects if `p` hasn't settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} did not answer within ${Math.round(ms / 100) / 10} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(errorText(e)));
      },
    );
  });
}

/* ------------------------------------------------------------------------------------------- */
/* Reading from the database and the running app                                               */
/* ------------------------------------------------------------------------------------------- */

/** Newest Device check per mode, without loading the whole table at once. */
export async function latestDeviceChecks(): Promise<LatestDeviceChecks> {
  const best: LatestDeviceChecks = { standalone: null, browser: null };
  await db().deviceChecks.each((row) => keepIfNewer(best, row));
  return best;
}

/** The last Snap's time and size (for the Report screen), or null if none was taken. */
export async function lastSnapInfo(): Promise<{ ts: number; bytes: number; type: string } | null> {
  const row = await db().blobs.get('last-snap');
  return row ? { ts: row.ts, bytes: row.blob.size, type: row.blob.type } : null;
}

async function readLogs(): Promise<LogRow[]> {
  const stored = await db().logs.orderBy('id').reverse().limit(LOG_LIMIT).toArray();
  stored.reverse();
  return mergeLogs(stored, recentLogs());
}

async function storageInfo(): Promise<Record<string, unknown>> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.estimate) return { available: false };
  const est = await storage.estimate();
  const persisted = storage.persisted ? await storage.persisted() : null;
  return { usageBytes: est.usage ?? null, quotaBytes: est.quota ?? null, persisted };
}

function environmentInfo(): Record<string, unknown> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const scr = typeof screen !== 'undefined' ? screen : undefined;
  const g = globalThis as typeof globalThis & Partial<Window>;
  return {
    userAgent: nav?.userAgent ?? null,
    platform: nav?.platform ?? null,
    language: nav?.language ?? null,
    hardwareConcurrency: nav?.hardwareConcurrency ?? null,
    maxTouchPoints: nav?.maxTouchPoints ?? null,
    online: nav?.onLine ?? null,
    screen: scr
      ? {
          width: scr.width,
          height: scr.height,
          availWidth: scr.availWidth,
          availHeight: scr.availHeight,
          colorDepth: scr.colorDepth,
          orientation: scr.orientation?.type ?? null,
        }
      : null,
    viewport: {
      innerWidth: g.innerWidth ?? null,
      innerHeight: g.innerHeight ?? null,
      devicePixelRatio: g.devicePixelRatio ?? null,
    },
    secureContext: g.isSecureContext ?? null,
    crossOriginIsolated: g.crossOriginIsolated ?? null,
    address: typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : null,
    pageOpenForSeconds: Math.round(performance.now() / 1000),
  };
}

function hudSnapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(hud) as unknown as Array<[string, Signal<unknown>]>) out[k] = s.peek();
  return out;
}

/** A copy of a stored blob in memory: a photo that can't be read is skipped here, not halfway through zipping. */
async function readableCopy(blob: Blob): Promise<Blob> {
  return new Blob([await blob.arrayBuffer()], { type: blob.type });
}

/* ------------------------------------------------------------------------------------------- */
/* Collect and prepare                                                                         */
/* ------------------------------------------------------------------------------------------- */

/** Gathers everything into the list of files for the zip. Never throws for one missing part. */
export async function collectReport(opts: CollectOptions): Promise<CollectedReport> {
  const created = opts.now ?? new Date();
  const timeout = opts.workerTimeoutMs ?? WORKER_TIMEOUT_MS;
  const total = REPORT_STEPS.length;
  const problems: string[] = [];
  const step = (i: number) => opts.onProgress?.(REPORT_STEPS[i - 1]!, i, total);
  async function attempt<T>(what: string, fn: () => Promise<T> | T, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      problems.push(`${what}: ${errorText(err)}`);
      return fallback;
    }
  }

  // 1. Log (saved first, so lines still waiting in memory are included).
  step(1);
  await attempt('saving the log', () => flushLogs(), undefined);
  const logs = await attempt('reading the log', readLogs, recentLogs().slice(-LOG_LIMIT));
  const launches = await attempt('reading app launches', () => db().launches.orderBy('ts').reverse().limit(LAUNCH_LIMIT).toArray(), [] as LaunchRow[]);

  // 2. Device checks, storage.
  step(2);
  const deviceChecks = await attempt('reading Device checks', latestDeviceChecks, { standalone: null, browser: null } as LatestDeviceChecks);
  const storage = await attempt('storage estimate', storageInfo, null);

  // 3. Workers: only ask the ones already running (a report must not start them).
  step(3);
  const tracker = peekTracker();
  let trackerStatus: TrackerStatus | null = null;
  let frames: Blob[] = [];
  if (tracker) {
    trackerStatus = await attempt('tracker status', () => withTimeout(tracker.api.status(), timeout, 'The tracker'), null);
    frames = await attempt('recent camera frames', () => withTimeout(tracker.api.recentFrames(), timeout * 2, 'The tracker'), [] as Blob[]);
  }
  const reader = peekReader();
  const readerMemory: WorkerMemory | null = reader
    ? await attempt('reader memory', () => withTimeout(reader.api.memory(), timeout, 'The photo reader'), null)
    : null;

  // 4. Photos.
  step(4);
  const snapRow = await attempt('reading the last photo', () => db().blobs.get('last-snap'), undefined as BlobRow | undefined);
  const previewRow = await attempt('reading the photo preview', () => db().blobs.get('last-snap-preview'), undefined as BlobRow | undefined);

  const images: ReportFileInput[] = [];
  const frameNames: string[] = [];
  frames.forEach((blob, i) => {
    const name = `frames/recent-${i + 1}.${imageExtension(blob.type)}`;
    frameNames.push(name);
    images.push({ name, blob, stored: true });
  });
  let previewName: string | null = null;
  if (previewRow) {
    const blob = await attempt('copying the photo preview', () => readableCopy(previewRow.blob), null);
    if (blob) {
      previewName = `photo/last-snap-preview.${imageExtension(blob.type)}`;
      images.push({ name: previewName, blob, stored: true });
    }
  }
  let fullPhotoName: string | null = null;
  if (opts.includeFullPhoto && snapRow) {
    const blob = await attempt('copying the full-size photo', () => readableCopy(snapRow.blob), null);
    if (blob) {
      fullPhotoName = `photo/last-snap-full.${imageExtension(blob.type)}`;
      images.push({ name: fullPhotoName, blob, stored: true });
    }
  } else if (opts.includeFullPhoto) {
    problems.push('full-size photo: no photo has been taken yet');
  }

  const mode = await attempt('display mode', () => displayMode(), 'browser' as DisplayMode);
  const report: Record<string, unknown> = {
    reportFormat: REPORT_FORMAT,
    app: 'Puzzle Lens',
    appVersion: APP_VERSION,
    created: created.toISOString(),
    createdLocal: created.toLocaleString(),
    timezoneOffsetMinutes: created.getTimezoneOffset(),
    displayMode: mode,
    previousEndedUnexpectedly: previousEndedUnexpectedly.peek(),
    environment: await attempt('device details', environmentInfo, null),
    settings: await attempt('settings', settingsSnapshot, null),
    storage,
    deviceChecks,
    launches,
    hud: await attempt('speed display', hudSnapshot, null),
    camera: {
      state: cameraState.peek(),
      error: cameraError.peek(),
      info: cameraInfo.peek(),
      lenses: cameraDevices.peek().map((d) => d.label),
    },
    workers: {
      tracker: { running: tracker !== null, init: trackerInfo.peek(), status: trackerStatus },
      reader: { running: reader !== null, init: readerInfo.peek(), memory: readerMemory },
    },
    lastSnap: snapRow
      ? { savedAt: new Date(snapRow.ts).toISOString(), bytes: snapRow.blob.size, type: snapRow.blob.type, details: snapRow.meta ?? null, includedAtFullSize: fullPhotoName !== null }
      : null,
    lastSnapPreview: previewRow ? { savedAt: new Date(previewRow.ts).toISOString(), bytes: previewRow.blob.size, type: previewRow.blob.type } : null,
    contents: images.map((f) => ({ name: f.name, bytes: f.blob?.size ?? 0, type: f.blob?.type ?? '' })),
    problems,
    logs,
  };

  const readme = reportReadme({ created, appVersion: APP_VERSION, mode, logCount: logs.length, frameNames, previewName, fullPhotoName });
  const files: ReportFileInput[] = [
    { name: README_NAME, text: readme },
    { name: REPORT_JSON_NAME, text: toReportJson(report) },
    ...images,
  ];
  return {
    fileName: reportFileName(created),
    createdAt: created,
    files,
    summary: { frames: frameNames.length, hasPreview: previewName !== null, hasFullPhoto: fullPhotoName !== null, logCount: logs.length, problems },
  };
}

/** Collects and zips (in the report worker). Returns a ready-to-share File. Throws if zipping fails. */
export async function prepareReport(opts: CollectOptions): Promise<PreparedReport> {
  const collected = await collectReport(opts);
  opts.onProgress?.(REPORT_STEPS[REPORT_STEPS.length - 1]!, REPORT_STEPS.length, REPORT_STEPS.length);
  const blob = await withTimeout(reportWorker().build(collected.files), BUILD_TIMEOUT_MS, 'Packing the report');
  const file = new File([blob], collected.fileName, { type: 'application/zip', lastModified: collected.createdAt.getTime() });
  logInfo('report', `Report prepared: ${collected.fileName} (${formatBytes(file.size)})`, collected.summary);
  return { ...collected, file };
}
