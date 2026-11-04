import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  clearMemprobe,
  CRASH_RESULT_MAX_AGE_MS,
  isMemprobeMessage,
  loadMemprobe,
  MEMPROBE_KEY,
  memoryEntryFromCrash,
  memoryEntryFromOutcome,
  saveMemprobe,
  type KeyValueStore,
} from '../../src/device/memory';
import { loadDeviceCheckHistory, saveDeviceCheck } from '../../src/device/store';
import { applyRun, carryForward, isFromOlderVersion, newResults } from '../../src/device/format';
import { makeEntry } from '../../src/device/catalog';
import { db } from '../../src/db/db';
import type { DeviceEnvironment } from '../../src/device/types';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('memory test record', () => {
  it('saves and loads progress under the agreed key', () => {
    const s = memoryStore();
    expect(saveMemprobe(s, { startedAt: 1, reachedMB: 640, finished: false })).toBe(true);
    expect(s.data.has(MEMPROBE_KEY)).toBe(true);
    expect(MEMPROBE_KEY).toBe('puzzle-lens.memprobe');
    expect(loadMemprobe(s)).toMatchObject({ startedAt: 1, reachedMB: 640, finished: false });
    clearMemprobe(s);
    expect(loadMemprobe(s)).toBeNull();
  });

  it('survives broken or blocked storage', () => {
    const s = memoryStore();
    s.data.set(MEMPROBE_KEY, '{not json');
    expect(loadMemprobe(s)).toBeNull();
    s.data.set(MEMPROBE_KEY, JSON.stringify({ reachedMB: 'x' }));
    expect(loadMemprobe(s)).toBeNull();
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(saveMemprobe(throwing, { startedAt: 1, reachedMB: 1, finished: false })).toBe(false);
    expect(loadMemprobe(throwing)).toBeNull();
    expect(() => clearMemprobe(throwing)).not.toThrow();
    expect(saveMemprobe(null, { startedAt: 1, reachedMB: 1, finished: false })).toBe(false);
  });

  it('turns a recent unfinished record into "iOS closed the app at about X MB"', () => {
    const start = 1_000_000;
    const rec = { startedAt: start, reachedMB: 1408, finished: false, lastStepAt: start + 40_000 };
    const e = memoryEntryFromCrash(rec, { detectedAt: start + 90_000 });
    expect(e.id).toBe('memory-headroom');
    expect(e.status).toBe('yes');
    expect(e.value).toBe('iOS closed the app at about 1,408 MB');
    expect(memoryEntryFromCrash({ ...rec, reachedMB: 0 }, { detectedAt: start + 90_000 }).status).toBe('partial');
  });

  it('treats an old unfinished record as interrupted, not as a measurement', () => {
    const start = 1_000_000;
    const rec = { startedAt: start, reachedMB: 1408, finished: false, lastStepAt: start + 40_000 };
    const old = memoryEntryFromCrash(rec, { detectedAt: start + 40_000 + CRASH_RESULT_MAX_AGE_MS + 1 });
    expect(old.status).toBe('partial');
    expect(old.value).toBe('The memory test was interrupted; please run it again');
    // Without lastStepAt the start time is used.
    expect(memoryEntryFromCrash({ startedAt: start, reachedMB: 640, finished: false }, { detectedAt: start + 60 * 60_000 }).status).toBe('partial');
    // A clock that went backwards doesn't count as recent either.
    expect(memoryEntryFromCrash(rec, { detectedAt: start }).status).toBe('partial');
    // …unless the app itself knows the last visit ended while on screen.
    expect(memoryEntryFromCrash(rec, { detectedAt: start + 60 * 60_000, previousVisitEndedUnexpectedly: true }).status).toBe('yes');
  });

  it('keeps the time of the last saved step', () => {
    const s = memoryStore();
    saveMemprobe(s, { startedAt: 1, reachedMB: 128, finished: false, lastStepAt: 7 });
    expect(loadMemprobe(s)?.lastStepAt).toBe(7);
    s.data.set(MEMPROBE_KEY, JSON.stringify({ startedAt: 1, reachedMB: 1, finished: false, lastStepAt: 'x' }));
    expect(loadMemprobe(s)?.lastStepAt).toBeUndefined();
  });

  it('words the worker outcomes', () => {
    expect(memoryEntryFromOutcome({ kind: 'limit', reachedMB: 1216 }).value).toBe('Reached 1,216 MB, then the iPhone refused more (the app stayed open)');
    expect(memoryEntryFromOutcome({ kind: 'done', reachedMB: 1793 }).status).toBe('yes');
    const err = memoryEntryFromOutcome({ kind: 'error', reachedMB: 0, message: 'RangeError' });
    expect(err.status).toBe('error');
    expect(err.value).toBe('RangeError');
  });

  it('recognises worker messages', () => {
    expect(isMemprobeMessage({ kind: 'step', reachedMB: 64 })).toBe(true);
    expect(isMemprobeMessage({ kind: 'nope', reachedMB: 64 })).toBe(false);
    expect(isMemprobeMessage({ kind: 'done' })).toBe(false);
    expect(isMemprobeMessage(null)).toBe(false);
  });
});

describe('saved Device check results', () => {
  const env = { userAgent: 'test', screen: { width: 1, height: 1, availWidth: 1, availHeight: 1, orientation: null }, viewport: { width: 1, height: 1 } } as DeviceEnvironment;

  it('keeps the newest results per display mode', async () => {
    await db().deviceChecks.clear();
    const browser1 = applyRun(newResults('1', 'browser', env, 1000), [makeEntry('opfs', 'yes', 'Available')], 'automatic', 1000);
    const standalone = applyRun(newResults('1', 'standalone', env, 2000), [makeEntry('opfs', 'no', 'Not available')], 'automatic', 2000);
    const browser2 = applyRun(browser1, [makeEntry('memory-headroom', 'yes', 'x')], 'memory', 3000);
    await saveDeviceCheck(browser1);
    await saveDeviceCheck(standalone);
    await saveDeviceCheck(browser2);
    await db().deviceChecks.add({ ts: 4000, mode: 'browser', appVersion: '1', results: { not: 'valid' } });

    const h = await loadDeviceCheckHistory();
    expect(h.latest?.results.ts).toBe(3000);
    expect(h.byMode.browser?.results.checks.map((c) => c.id)).toEqual(['opfs', 'memory-headroom']);
    expect(h.byMode.standalone?.results.ts).toBe(2000);
    const row = await db().deviceChecks.get(h.latest!.id);
    expect(row).toMatchObject({ ts: 3000, mode: 'browser', appVersion: '1' });
  });

  it('keeps earlier rows after an app update, tagged with the version that measured them', async () => {
    const v1 = applyRun(newResults('1', 'browser', env, 1000), [makeEntry('opfs', 'yes', 'Available')], 'automatic', 1000);
    const v2 = applyRun(carryForward(v1, '2'), [makeEntry('file-camera', 'yes', '12 MP')], 'fileCamera', 2000);
    expect(v2.appVersion).toBe('2');
    expect(v2.parts).toEqual({ automatic: 1000, fileCamera: 2000 });
    const byId = Object.fromEntries(v2.checks.map((c) => [c.id, c]));
    expect(byId['opfs']?.appVersion).toBe('1');
    expect(byId['file-camera']?.appVersion).toBe('2');
    expect(isFromOlderVersion(byId['opfs']!, v2)).toBe(true);
    expect(isFromOlderVersion(byId['file-camera']!, v2)).toBe(false);
    // Same version: nothing changes.
    expect(carryForward(v2, '2')).toBe(v2);
  });
});
