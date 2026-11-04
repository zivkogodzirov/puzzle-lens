/**
 * src/log/logger.ts (in-memory ring buffer + batched saving to the database) and
 * src/perf/hud.ts (smoothing and rate meters for the performance HUD).
 */
import 'fake-indexeddb/auto'; // must come first: Dexie picks up indexedDB when it loads
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/db';
import { flushLogs, log, logError, logInfo, logWarn, recentLogs, RingBuffer, setLogPersistence } from '../../src/log/logger';
import { Ema, hud, mb, RateMeter, recordTrackerResult, resetHud } from '../../src/perf/hud';
import type { TrackerFrameResult } from '../../src/shared/types';

beforeAll(() => {
  // No 2-second flush timer during tests; flushLogs() is called explicitly.
  setLogPersistence(false);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('RingBuffer', () => {
  it('keeps only the newest `capacity` items, oldest first', () => {
    const rb = new RingBuffer<number>(3);
    expect(rb.size).toBe(0);
    expect(rb.toArray()).toEqual([]);
    for (let i = 1; i <= 5; i++) rb.push(i);
    expect(rb.size).toBe(3);
    expect(rb.toArray()).toEqual([3, 4, 5]);
    rb.push(6);
    expect(rb.toArray()).toEqual([4, 5, 6]);
  });

  it('toArray returns a copy', () => {
    const rb = new RingBuffer<string>(2);
    rb.push('a');
    const arr = rb.toArray();
    arr.push('x');
    expect(rb.toArray()).toEqual(['a']);
  });

  it('stays bounded over many pushes', () => {
    const rb = new RingBuffer<number>(500);
    for (let i = 0; i < 10_000; i++) rb.push(i);
    expect(rb.size).toBe(500);
    expect(rb.toArray()[0]).toBe(9500);
    expect(rb.toArray()[499]).toBe(9999);
  });

  it('capacity 0 keeps nothing', () => {
    const rb = new RingBuffer<number>(0);
    rb.push(1);
    expect(rb.size).toBe(0);
  });
});

describe('log / recentLogs / flushLogs', () => {
  beforeEach(async () => {
    await flushLogs();
    await db().logs.clear();
  });

  it('records level, source, message and a safe copy of the data', () => {
    const data = { a: 1, nested: { b: [1, 2] } };
    logInfo('test', 'hello', data);
    data.a = 99; // later changes must not affect the stored copy
    logWarn('test', 'careful');
    const err = new Error('boom');
    logError('test', 'failed', err);
    const last3 = recentLogs().slice(-3);
    expect(last3.map((r) => [r.level, r.source, r.message])).toEqual([
      ['info', 'test', 'hello'],
      ['warn', 'test', 'careful'],
      ['error', 'test', 'failed'],
    ]);
    expect(last3[0]!.data).toEqual({ a: 1, nested: { b: [1, 2] } });
    expect(last3[1]!.data).toBeUndefined();
    expect(last3[2]!.data).toMatchObject({ name: 'Error', message: 'boom' });
    expect(typeof last3[0]!.ts).toBe('number');
  });

  it('data that cannot be turned into JSON is stored as text instead of throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => log('info', 'test', 'circular', circular)).not.toThrow();
    expect(recentLogs().at(-1)!.data).toBe('[object Object]');
  });

  it('flushLogs saves pending rows to the database once', async () => {
    logInfo('db', 'one');
    logInfo('db', 'two');
    await flushLogs();
    const rows = await db().logs.where('level').equals('info').toArray();
    expect(rows.map((r) => r.message)).toEqual(['one', 'two']);
    await flushLogs(); // nothing pending: no duplicates
    expect(await db().logs.count()).toBe(2);
  });

  it('keeps the database log to the newest 2000 rows and memory to 500', async () => {
    for (let i = 0; i < 2100; i++) log('info', 'bulk', `m${i}`);
    await flushLogs();
    expect(await db().logs.count()).toBe(2000);
    const oldest = await db().logs.orderBy('id').first();
    expect(oldest?.message).toBe('m100');
    const newest = await db().logs.orderBy('id').last();
    expect(newest?.message).toBe('m2099');
    expect(recentLogs().length).toBe(500);
    expect(recentLogs().at(-1)!.message).toBe('m2099');
  });
});

describe('Ema', () => {
  it('starts at the first value, then moves a fraction alpha towards each new one', () => {
    const e = new Ema(0.1);
    expect(e.value).toBeNull();
    expect(e.add(10)).toBe(10);
    expect(e.add(20)).toBeCloseTo(11, 12);
    expect(e.add(20)).toBeCloseTo(11.9, 12);
  });

  it('converges to a constant input', () => {
    const e = new Ema(0.15);
    e.add(100);
    for (let i = 0; i < 200; i++) e.add(5);
    expect(e.value!).toBeCloseTo(5, 6);
  });
});

describe('RateMeter', () => {
  it('measures events per second over the window', () => {
    const r = new RateMeter(2000);
    for (let i = 0; i <= 10; i++) r.tick(i * 100);
    expect(r.rate(1000)).toBeCloseTo(10, 9);
  });

  it('30 fps for 5 s reads ≈ 30 (only the last 2 s count)', () => {
    const r = new RateMeter(2000);
    let t = 0;
    for (let i = 0; i < 150; i++) r.tick((t = i * (1000 / 30)));
    expect(r.rate(t)).toBeCloseTo(30, 1);
  });

  it('drops to 0 when events stop, and with fewer than two events', () => {
    const r = new RateMeter(2000);
    expect(r.rate(0)).toBe(0);
    r.tick(0);
    expect(r.rate(10)).toBe(0);
    r.tick(100);
    expect(r.rate(100)).toBeGreaterThan(0);
    expect(r.rate(2101)).toBe(0);
  });
});

describe('HUD signals', () => {
  const result = (over: Partial<TrackerFrameResult> = {}): TrackerFrameResult => ({
    frameIndex: 0,
    timestampUs: 0,
    width: 1920,
    height: 1440,
    analysisWidth: 960,
    markers: [{ id: 1, corners: [0, 0, 1, 0, 1, 1, 0, 1] }],
    sharpness: 123,
    timings: { markers: 10, resize: 2 },
    source: 'mstp',
    format: 'NV12',
    rotation: null,
    flip: null,
    frameInfo: null,
    ...over,
  }) as TrackerFrameResult;

  it('recordTrackerResult fills the HUD and smooths stage times', () => {
    resetHud();
    recordTrackerResult(result());
    expect(hud.trackerStages.value).toEqual({ markers: 10, resize: 2 });
    expect(hud.markersSeen.value).toBe(1);
    expect(hud.sharpness.value).toBe(123);
    expect(hud.frameSource.value).toBe('direct (worker)');
    expect(hud.frameFormat.value).toBe('NV12');
    expect(hud.frameSize.value).toBe('1920×1440');
    recordTrackerResult(result({ timings: { markers: 20, resize: 2 }, source: 'bitmap', format: null, markers: [] }));
    expect(hud.trackerStages.value.markers).toBeCloseTo(11.5, 9); // EMA alpha 0.15
    expect(hud.frameSource.value).toBe('copied (fallback)');
    expect(hud.frameFormat.value).toBe('unknown');
    expect(hud.markersSeen.value).toBe(0);
  });

  it('resetHud clears the numbers and the smoothing', () => {
    recordTrackerResult(result({ timings: { markers: 50 } }));
    resetHud();
    expect(hud.trackerStages.value).toEqual({});
    expect(hud.trackerFps.value).toBe(0);
    expect(hud.markersSeen.value).toBe(0);
    recordTrackerResult(result({ timings: { markers: 7 } }));
    expect(hud.trackerStages.value.markers).toBe(7); // fresh EMA, not blended with 50
  });

  it('mb() formats bytes as whole megabytes', () => {
    expect(mb(0)).toBe('0 MB');
    expect(mb(null)).toBe('0 MB');
    expect(mb(undefined)).toBe('0 MB');
    expect(mb(134217728)).toBe('128 MB');
    expect(mb(1.6 * 1048576)).toBe('2 MB');
  });
});
