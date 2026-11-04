/**
 * Memory headroom test bookkeeping (RESEARCH §19 item 8). The test grows memory in a worker
 * until something gives. Progress is saved synchronously after every step, so if iOS kills the
 * page, the next visit to Device check finds an unfinished record: the last saved step IS the
 * measurement ("iOS closed the app at about X MB"). Pure; the storage is passed in.
 */
import type { CheckEntry, DisplayMode } from './types';
import { makeEntry } from './catalog';
import { formatMB } from './format';

export const MEMPROBE_KEY = 'puzzle-lens.memprobe';
export const MEMPROBE_STEP_MB = 64;
export const MEMPROBE_MAX_MB = 1800;
/**
 * An unfinished record only counts as "iOS closed the app" if Device check is opened again within
 * this time of the last saved step. Older records more likely mean the test was interrupted some
 * other way (the phone was locked, the app swiped away, iOS cleared it from the background later).
 */
export const CRASH_RESULT_MAX_AGE_MS = 5 * 60_000;

export interface MemprobeRecord {
  startedAt: number;
  reachedMB: number;
  finished: boolean;
  /** When the last step was saved (ms since epoch). */
  lastStepAt?: number;
  mode?: DisplayMode;
  appVersion?: string;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type MemprobeMessage = { kind: 'step' | 'limit' | 'done' | 'error'; reachedMB: number; message?: string };

export function isMemprobeMessage(x: unknown): x is MemprobeMessage {
  if (!x || typeof x !== 'object') return false;
  const m = x as Partial<MemprobeMessage>;
  return (m.kind === 'step' || m.kind === 'limit' || m.kind === 'done' || m.kind === 'error') && typeof m.reachedMB === 'number';
}

/** Saves progress; returns false if storage is unavailable (e.g. full or blocked). */
export function saveMemprobe(store: KeyValueStore | null | undefined, rec: MemprobeRecord): boolean {
  try {
    store?.setItem(MEMPROBE_KEY, JSON.stringify(rec));
    return Boolean(store);
  } catch {
    return false;
  }
}

export function loadMemprobe(store: KeyValueStore | null | undefined): MemprobeRecord | null {
  try {
    const raw = store?.getItem(MEMPROBE_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<MemprobeRecord>;
    if (typeof r.startedAt !== 'number' || typeof r.reachedMB !== 'number' || typeof r.finished !== 'boolean') return null;
    return {
      startedAt: r.startedAt,
      reachedMB: r.reachedMB,
      finished: r.finished,
      lastStepAt: typeof r.lastStepAt === 'number' ? r.lastStepAt : undefined,
      mode: r.mode,
      appVersion: r.appVersion,
    };
  } catch {
    return null;
  }
}

export function clearMemprobe(store: KeyValueStore | null | undefined): void {
  try {
    store?.removeItem(MEMPROBE_KEY);
  } catch {
    /* ignore */
  }
}

export interface CrashContext {
  /** When the unfinished record was found (ms since epoch). */
  detectedAt: number;
  /** The app's own "ended unexpectedly while on screen" flag for the previous visit. */
  previousVisitEndedUnexpectedly?: boolean;
}

/**
 * The result when the previous visit ended in the middle of the test. It only counts as a
 * measurement if it is recent (or the app knows it was closed while on screen); otherwise the test
 * was probably interrupted, and the owner is asked to run it again.
 */
export function memoryEntryFromCrash(rec: MemprobeRecord, ctx: CrashContext): CheckEntry {
  const lastWrite = rec.lastStepAt ?? rec.startedAt;
  const ageMs = ctx.detectedAt - lastWrite;
  const recent = ageMs >= 0 && ageMs <= CRASH_RESULT_MAX_AGE_MS;
  const counts = recent || ctx.previousVisitEndedUnexpectedly === true;
  const details = {
    how: counts ? 'app closed during the test' : 'test interrupted',
    ...rec,
    ageSeconds: Math.round(ageMs / 1000),
    stepMB: MEMPROBE_STEP_MB,
    maxMB: MEMPROBE_MAX_MB,
    ...ctx,
  };
  if (!counts) return makeEntry('memory-headroom', 'partial', 'The memory test was interrupted; please run it again', details);
  if (rec.reachedMB <= 0) return makeEntry('memory-headroom', 'partial', 'iOS closed the app before the first step', details);
  return makeEntry('memory-headroom', 'yes', `iOS closed the app at about ${formatMB(rec.reachedMB)}`, details);
}

/** The result when the worker reported back (the app stayed open). */
export function memoryEntryFromOutcome(msg: MemprobeMessage, extra: Record<string, unknown> = {}): CheckEntry {
  const details = { how: msg.kind, reachedMB: msg.reachedMB, message: msg.message, stepMB: MEMPROBE_STEP_MB, maxMB: MEMPROBE_MAX_MB, ...extra };
  switch (msg.kind) {
    case 'limit':
      return makeEntry('memory-headroom', 'yes', `Reached ${formatMB(msg.reachedMB)}, then the iPhone refused more (the app stayed open)`, details);
    case 'done':
      return makeEntry('memory-headroom', 'yes', `Reached ${formatMB(msg.reachedMB)} (the most this test tries) without problems`, details);
    case 'error':
      return makeEntry('memory-headroom', 'error', msg.message ?? 'The memory test could not start', details);
    default:
      return makeEntry('memory-headroom', 'error', 'The memory test stopped unexpectedly', details);
  }
}
