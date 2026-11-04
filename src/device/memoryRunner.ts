/**
 * Runs the opt-in memory headroom test with src/workers/memprobe.worker.ts. Progress is saved to
 * localStorage synchronously after every step (see memory.ts for why). Main thread.
 */
import { APP_VERSION, displayMode, previousEndedUnexpectedly } from '../app/env';
import { peekReader, peekTracker } from '../app/workers';
import type { CheckEntry } from './types';
import {
  clearMemprobe,
  isMemprobeMessage,
  loadMemprobe,
  MEMPROBE_MAX_MB,
  MEMPROBE_STEP_MB,
  memoryEntryFromCrash,
  memoryEntryFromOutcome,
  saveMemprobe,
  type KeyValueStore,
  type MemprobeRecord,
} from './memory';

const OVERALL_TIMEOUT_MS = 120_000;

function storage(): KeyValueStore | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export interface MemoryTestHandle {
  /**
   * The result row, or null when the test was stopped because the app went to the background
   * (nothing is measured then, and nothing should replace an earlier result).
   */
  done: Promise<CheckEntry | null>;
  /** Stops the test (e.g. when leaving the screen); `done` then resolves to an error row. */
  cancel(): void;
}

/** Why `done` resolved to null. */
export const BACKGROUND_STOP_MESSAGE =
  'The memory test stopped because Puzzle Lens went to the background. Run it again and keep Puzzle Lens on screen until it finishes.';

export function startMemoryTest(onStep: (reachedMB: number) => void): MemoryTestHandle {
  const store = storage();
  const rec: MemprobeRecord = { startedAt: Date.now(), reachedMB: 0, finished: false, mode: displayMode(), appVersion: APP_VERSION };
  const context = { otherHelpersRunning: { reader: Boolean(peekReader()), tracker: Boolean(peekTracker()) }, progressSaved: saveMemprobe(store, rec) };
  let worker: Worker | null = null;
  let settle: ((e: CheckEntry | null) => void) | null = null;
  const done = new Promise<CheckEntry | null>((resolve) => {
    settle = resolve;
  });
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Going to the background (switching apps, locking the phone) is not a memory measurement: stop and
  // forget the record, so the next visit doesn't mistake it for "iOS closed the app". A real memory
  // kill happens while the app is on screen and fires neither event, so its record survives.
  const onHidden = () => {
    if (document.visibilityState === 'hidden') finish(null, false);
  };
  const onPageHide = () => finish(null, false);

  const finish = (entry: CheckEntry | null, keepRecord = true) => {
    if (!settle) return;
    const s = settle;
    settle = null;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onHidden);
    removeEventListener('pagehide', onPageHide);
    worker?.terminate();
    worker = null;
    if (keepRecord) saveMemprobe(store, { ...rec, finished: true });
    else clearMemprobe(store);
    s(entry);
  };
  document.addEventListener('visibilitychange', onHidden);
  addEventListener('pagehide', onPageHide);

  try {
    worker = new Worker(new URL('../workers/memprobe.worker.ts', import.meta.url), { type: 'module', name: 'memprobe' });
    worker.addEventListener('message', (ev: MessageEvent<unknown>) => {
      const msg = ev.data;
      if (!isMemprobeMessage(msg)) return;
      if (msg.kind === 'step') {
        rec.reachedMB = msg.reachedMB;
        rec.lastStepAt = Date.now();
        saveMemprobe(store, rec); // synchronous: survives iOS closing the page right after
        onStep(msg.reachedMB);
        return;
      }
      rec.reachedMB = Math.max(rec.reachedMB, msg.reachedMB);
      finish(memoryEntryFromOutcome(msg, context));
    });
    worker.addEventListener('error', (ev) => {
      finish(memoryEntryFromOutcome({ kind: 'error', reachedMB: rec.reachedMB, message: ev.message || 'The memory test could not start' }, context));
    });
    worker.postMessage({ stepMB: MEMPROBE_STEP_MB, maxMB: MEMPROBE_MAX_MB });
    timer = setTimeout(() => {
      finish(memoryEntryFromOutcome({ kind: 'error', reachedMB: rec.reachedMB, message: `No answer after ${OVERALL_TIMEOUT_MS / 1000} s (reached ${rec.reachedMB} MB)` }, context));
    }, OVERALL_TIMEOUT_MS);
  } catch (err) {
    finish(memoryEntryFromOutcome({ kind: 'error', reachedMB: 0, message: String((err as Error)?.message ?? err) }, context));
  }

  return {
    done,
    cancel() {
      finish(memoryEntryFromOutcome({ kind: 'error', reachedMB: rec.reachedMB, message: 'Stopped before the end' }, context), false);
    },
  };
}

/**
 * True if a memory test was started and never finished, so its result is waiting in Device check
 * (doesn't clear anything; the Home screen uses it to point there).
 */
export function hasPendingMemoryResult(): boolean {
  const rec = loadMemprobe(storage());
  return Boolean(rec && !rec.finished);
}

/**
 * On opening the Device check: if the last memory test never finished, iOS most likely closed the
 * app during it, and the last saved step is the measurement (if it's recent; see memoryEntryFromCrash).
 * Returns that row (and clears the record).
 */
export function takeCrashedMemoryResult(): CheckEntry | null {
  const store = storage();
  const rec = loadMemprobe(store);
  if (!rec) return null;
  clearMemprobe(store);
  if (rec.finished) return null;
  return memoryEntryFromCrash(rec, { detectedAt: Date.now(), previousVisitEndedUnexpectedly: previousEndedUnexpectedly.value });
}
