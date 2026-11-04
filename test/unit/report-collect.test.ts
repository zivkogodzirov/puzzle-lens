import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8, type UnzipFileInfo } from 'fflate';
import type { ReportFileInput } from '../../src/shared/apis';
import type { DeviceCheckRow, LogRow } from '../../src/db/db';

/* The modules below touch window/document when loaded, so the tests replace them with stand-ins. */
const fake = vi.hoisted(() => ({
  tracker: null as unknown,
  reader: null as unknown,
}));

vi.mock('../../src/app/env', async () => {
  const { signal } = await import('@preact/signals');
  return { APP_VERSION: '9.9.9-test', displayMode: () => 'standalone', previousEndedUnexpectedly: signal(true) };
});

vi.mock('../../src/camera/camera', async () => {
  const { signal } = await import('@preact/signals');
  return {
    cameraState: signal('live'),
    cameraError: signal(null),
    cameraInfo: signal({ label: 'Back Camera', deviceId: 'abc', requested: { width: { ideal: 4032 } }, settings: { width: 4032, height: 3024 }, capabilities: {} }),
    cameraDevices: signal([{ label: 'Back Camera' }, { label: 'Back Telephoto Camera' }]),
  };
});

vi.mock('../../src/app/workers', async () => {
  const { signal } = await import('@preact/signals');
  const { buildZip } = await import('../../src/report/zip');
  return {
    peekTracker: () => fake.tracker,
    peekReader: () => fake.reader,
    trackerInfo: signal({ ok: true, cvLoadMs: 123, capabilities: {} }),
    readerInfo: signal(null),
    // Same packing as src/workers/report.worker.ts, run in-process.
    reportWorker: () => ({
      async build(files: ReportFileInput[]): Promise<Blob> {
        const entries = [];
        for (const f of files) {
          if (f.text !== undefined) entries.push({ name: f.name, data: f.text, stored: f.stored });
          else if (f.blob) entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()), stored: f.stored ?? true });
        }
        return new Blob([buildZip(entries) as BlobPart], { type: 'application/zip' });
      },
    }),
  };
});

const { db, eraseAllData } = await import('../../src/db/db');
const { logInfo, setLogPersistence } = await import('../../src/log/logger');
const collect = await import('../../src/report/collect');
const { buildZip } = await import('../../src/report/zip');

const jpeg = (n: number, fill: number) => {
  const bytes = new Uint8Array(n).fill(fill);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  return new Blob([bytes], { type: 'image/jpeg' });
};

function check(id: number, ts: number, mode: 'standalone' | 'browser'): DeviceCheckRow {
  return { id, ts, mode, appVersion: 'x', results: { marker: `${mode}-${ts}` } };
}

/** Packs files exactly like the report worker does. */
async function zipFiles(files: ReportFileInput[]): Promise<Uint8Array> {
  const entries = [];
  for (const f of files) {
    if (f.text !== undefined) entries.push({ name: f.name, data: f.text, stored: f.stored });
    else if (f.blob) entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()), stored: f.stored ?? true });
  }
  return buildZip(entries);
}

function unzipWithMethods(zip: Uint8Array): { files: Record<string, Uint8Array>; methods: Record<string, number> } {
  const methods: Record<string, number> = {};
  const files = unzipSync(zip, {
    filter: (info: UnzipFileInfo) => {
      methods[info.name] = info.compression;
      return true;
    },
  });
  return { files, methods };
}

async function seed(): Promise<void> {
  const d = db();
  await d.deviceChecks.bulkAdd([check(1, 100, 'browser'), check(2, 200, 'standalone'), check(3, 300, 'browser'), check(4, 150, 'standalone')]);
  await d.launches.bulkAdd(
    Array.from({ length: 25 }, (_, i) => ({ ts: i + 1, mode: 'standalone' as const, appVersion: 'x', cameraPermission: 'prompt', previousEndedUnexpectedly: false })),
  );
  await d.logs.bulkAdd([
    { ts: 10, level: 'info', source: 'app', message: 'old line' },
    { ts: 11, level: 'error', source: 'camera', message: 'old error' },
  ]);
  await d.blobs.put({ id: 'last-snap', ts: 5000, kind: 'snap', blob: jpeg(5000, 7), meta: { method: 'takePhoto', stats: { width: 4032, height: 3024 } } });
  await d.blobs.put({ id: 'last-snap-preview', ts: 5001, kind: 'snap-preview', blob: jpeg(800, 9) });
}

beforeEach(async () => {
  setLogPersistence(false); // no background flush timer; collectReport flushes itself
  await eraseAllData();
  fake.tracker = null;
  fake.reader = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('report: pure helpers', () => {
  it('names the file with the local date and time', () => {
    expect(collect.reportFileName(new Date(2026, 10, 4, 9, 5))).toBe('puzzle-lens-report-2026-11-04-0905.zip');
    expect(collect.reportFileName(new Date(2027, 0, 31, 23, 59))).toBe('puzzle-lens-report-2027-01-31-2359.zip');
  });

  it('picks the newest Device check per mode, whatever the order', () => {
    const best = collect.latestPerMode([check(1, 100, 'browser'), check(2, 200, 'standalone'), check(3, 300, 'browser'), check(4, 150, 'standalone')]);
    expect(best.browser?.id).toBe(3);
    expect(best.standalone?.id).toBe(2);
    const onlyBrowser = collect.latestPerMode([check(1, 100, 'browser')]);
    expect(onlyBrowser.standalone).toBeNull();
    expect(collect.latestPerMode([]).browser).toBeNull();
  });

  it('merges saved and not-yet-saved log lines without losing or doubling any', () => {
    const stored: LogRow[] = [
      { id: 1, ts: 1, level: 'info', source: 'a', message: 'one' },
      { id: 2, ts: 3, level: 'info', source: 'a', message: 'three' },
    ];
    const memory: LogRow[] = [
      { ts: 3, level: 'info', source: 'a', message: 'three' }, // already saved
      { ts: 2, level: 'warn', source: 'b', message: 'two' }, // not saved
      { ts: 4, level: 'info', source: 'a', message: 'same' },
      { ts: 4, level: 'info', source: 'a', message: 'same' }, // a genuine duplicate line
    ];
    const merged = collect.mergeLogs(stored, memory);
    expect(merged.map((r) => r.message)).toEqual(['one', 'two', 'three', 'same', 'same']);
    expect(collect.mergeLogs(stored, memory, 2).map((r) => r.message)).toEqual(['same', 'same']);
  });

  it('writes a plain-English README that lists what is inside', () => {
    const base = { created: new Date(2026, 10, 4, 14, 32), appVersion: '1.2.3', mode: 'standalone' as const, logCount: 42 };
    const text = collect.reportReadme({ ...base, frameNames: ['frames/recent-1.jpg', 'frames/recent-2.jpg'], previewName: 'photo/last-snap-preview.jpg', fullPhotoName: null });
    expect(text).toContain('PUZZLE LENS REPORT');
    expect(text).toContain('Nothing has been sent anywhere');
    expect(text).toContain('only leaves your iPhone if you share it');
    expect(text).toContain('Home Screen app');
    expect(text).toContain('1.2.3');
    expect(text).toContain('report.json');
    expect(text).toContain('42 entries');
    expect(text).toContain('frames/: 2 small pictures');
    expect(text).toContain('photo/last-snap-preview.jpg');
    expect(text).not.toContain('last-snap-full');

    const withFull = collect.reportReadme({ ...base, mode: 'browser', frameNames: [], previewName: null, fullPhotoName: 'photo/last-snap-full.jpg' });
    expect(withFull).toContain('Safari tab');
    expect(withFull).toContain('photo/last-snap-full.jpg: your last photo at full size');
    expect(withFull).toContain('No pictures from the live camera');
  });

  it('formats sizes and picks image extensions', () => {
    expect(collect.formatBytes(500)).toBe('500 bytes');
    expect(collect.formatBytes(2048)).toBe('2 KB');
    expect(collect.formatBytes(3.45 * 1048576)).toBe('3.5 MB');
    expect(collect.imageExtension('image/jpeg')).toBe('jpg');
    expect(collect.imageExtension('image/heic')).toBe('heic');
    expect(collect.imageExtension('')).toBe('jpg');
  });

  it('keeps report.json writable even with blobs, typed arrays and loops inside', () => {
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    const json = collect.toReportJson({ ok: { n: 1 }, blob: new Blob(['abc'], { type: 'text/plain' }), arr: new Float32Array(1000), big: 10n, loop });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.ok).toEqual({ n: 1 });
    expect(parsed.blob).toEqual({ blob: 'text/plain', bytes: 3 });
    expect(parsed.arr).toEqual({ typedArray: 'Float32Array', bytes: 4000 });
    expect(parsed.big).toBe('10');
    expect(parsed.loop).toHaveProperty('couldNotBeSaved');
  });

  it('times out a worker that never answers', async () => {
    await expect(collect.withTimeout(new Promise(() => {}), 20, 'The tracker')).rejects.toThrow('did not answer');
    await expect(collect.withTimeout(Promise.resolve(5), 20, 'x')).resolves.toBe(5);
  });
});

describe('report: collecting from the database and the app', () => {
  it('reads the newest Device check per mode from the database', async () => {
    await seed();
    const latest = await collect.latestDeviceChecks();
    expect(latest.standalone?.ts).toBe(200);
    expect(latest.browser?.ts).toBe(300);
    expect(latest.browser?.results).toEqual({ marker: 'browser-300' });
  });

  it('collects everything into report.json, README, frames and photo preview', async () => {
    await seed();
    fake.tracker = {
      api: {
        status: async () => ({ running: true, source: 'mstp', framesReceived: 90, framesProcessed: 88, framesSkipped: 2, memory: { wasmBytes: 1, liveScoped: 0, livePersistent: 3, openFrames: 0 }, lastError: null }),
        recentFrames: async () => [jpeg(300, 1), jpeg(300, 2), jpeg(300, 3)],
      },
    };
    fake.reader = { api: { memory: async () => ({ wasmBytes: 64 * 1048576, liveScoped: 0, livePersistent: 0, openFrames: 0 }) } };
    logInfo('test', 'line logged just before the report'); // still waiting in memory

    const steps: number[] = [];
    const now = new Date(2026, 10, 4, 14, 32);
    const r = await collect.collectReport({ includeFullPhoto: false, now, onProgress: (_l, s) => steps.push(s) });

    expect(r.fileName).toBe('puzzle-lens-report-2026-11-04-1432.zip');
    expect(steps).toEqual([1, 2, 3, 4]);
    const names = r.files.map((f) => f.name);
    expect(names).toEqual(['README.txt', 'report.json', 'frames/recent-1.jpg', 'frames/recent-2.jpg', 'frames/recent-3.jpg', 'photo/last-snap-preview.jpg']);
    expect(r.files.filter((f) => f.blob).every((f) => f.stored === true)).toBe(true);
    expect(r.summary).toMatchObject({ frames: 3, hasPreview: true, hasFullPhoto: false, problems: [] });

    const report = JSON.parse(r.files[1]!.text!) as Record<string, any>;
    expect(report.appVersion).toBe('9.9.9-test');
    expect(report.created).toBe(now.toISOString());
    expect(report.displayMode).toBe('standalone');
    expect(report.previousEndedUnexpectedly).toBe(true);
    expect(report.environment.userAgent).toEqual(expect.any(String));
    expect(report.settings).toMatchObject({ units: 'mm', liveFormat: 'auto-4x3' });
    expect(report.deviceChecks.standalone.results).toEqual({ marker: 'standalone-200' });
    expect(report.deviceChecks.browser.results).toEqual({ marker: 'browser-300' });
    expect(report.launches).toHaveLength(20);
    expect(report.launches[0].ts).toBe(25);
    expect(report.logs.map((l: LogRow) => l.message)).toEqual(['old line', 'old error', 'line logged just before the report']);
    expect(report.hud).toHaveProperty('trackerFps');
    expect(report.camera.info.label).toBe('Back Camera');
    expect(report.camera.lenses).toEqual(['Back Camera', 'Back Telephoto Camera']);
    expect(report.workers.tracker.status.framesProcessed).toBe(88);
    expect(report.workers.tracker.init.cvLoadMs).toBe(123);
    expect(report.workers.reader.memory.wasmBytes).toBe(64 * 1048576);
    expect(report.lastSnap).toMatchObject({ bytes: 5000, type: 'image/jpeg', includedAtFullSize: false, details: { method: 'takePhoto' } });
    expect(report.lastSnapPreview.bytes).toBe(800);
    expect(report.contents).toHaveLength(4);
    expect(report.problems).toEqual([]);

    // The report saved the waiting line to the database first.
    expect((await db().logs.toArray()).some((row) => row.message === 'line logged just before the report')).toBe(true);
  });

  it('adds the full-size photo only when asked', async () => {
    await seed();
    const r = await collect.collectReport({ includeFullPhoto: true });
    const full = r.files.find((f) => f.name === 'photo/last-snap-full.jpg');
    expect(full).toBeDefined();
    expect(full!.blob!.size).toBe(5000);
    expect(new Uint8Array(await full!.blob!.arrayBuffer())[2]).toBe(7);
    expect(r.summary.hasFullPhoto).toBe(true);
    expect(r.files.find((f) => f.name === 'README.txt')!.text).toContain('your last photo at full size');
  });

  it('works on a fresh install: no workers, no photos, no Device checks', async () => {
    const r = await collect.collectReport({ includeFullPhoto: true });
    expect(r.files.map((f) => f.name)).toEqual(['README.txt', 'report.json']);
    const report = JSON.parse(r.files[1]!.text!) as Record<string, any>;
    expect(report.deviceChecks).toEqual({ standalone: null, browser: null });
    expect(report.workers.tracker).toMatchObject({ running: false, status: null });
    expect(report.lastSnap).toBeNull();
    expect(report.problems).toEqual(['full-size photo: no photo has been taken yet']);
  });

  it("doesn't wait for a tracker that never answers", async () => {
    fake.tracker = { api: { status: () => new Promise(() => {}), recentFrames: () => new Promise(() => {}) } };
    const t0 = Date.now();
    const r = await collect.collectReport({ includeFullPhoto: false, workerTimeoutMs: 30 });
    expect(Date.now() - t0).toBeLessThan(2000);
    const report = JSON.parse(r.files[1]!.text!) as Record<string, any>;
    expect(report.workers.tracker).toMatchObject({ running: true, status: null });
    expect(report.problems.join(' ')).toMatch(/tracker status: .*did not answer/);
    expect(report.problems.join(' ')).toMatch(/recent camera frames: .*did not answer/);
  });

  it('records a worker error instead of failing the report', async () => {
    fake.tracker = { api: { status: async () => Promise.reject(new Error('worker crashed')), recentFrames: async () => [] } };
    const r = await collect.collectReport({ includeFullPhoto: false });
    expect(r.summary.problems).toEqual(['tracker status: worker crashed']);
  });
});

describe('report: the zip', () => {
  it('unzips with report.json, README and images stored uncompressed', async () => {
    await seed();
    fake.tracker = { api: { status: async () => ({ running: false }), recentFrames: async () => [jpeg(400, 4)] } };
    const r = await collect.collectReport({ includeFullPhoto: true });
    const { files, methods } = unzipWithMethods(await zipFiles(r.files));

    expect(Object.keys(files).sort()).toEqual(['README.txt', 'frames/recent-1.jpg', 'photo/last-snap-full.jpg', 'photo/last-snap-preview.jpg', 'report.json']);
    const report = JSON.parse(strFromU8(files['report.json']!)) as Record<string, any>;
    expect(report.reportFormat).toBe(collect.REPORT_FORMAT);
    expect(report.appVersion).toBe('9.9.9-test');
    expect(strFromU8(files['README.txt']!)).toContain('PUZZLE LENS REPORT');
    expect(files['photo/last-snap-full.jpg']!.length).toBe(5000);
    expect(files['photo/last-snap-full.jpg']![0]).toBe(0xff);
    expect(files['frames/recent-1.jpg']!.length).toBe(400);
    // JPEGs stored as they are (0), text compressed (8 = deflate).
    expect(methods['photo/last-snap-full.jpg']).toBe(0);
    expect(methods['photo/last-snap-preview.jpg']).toBe(0);
    expect(methods['frames/recent-1.jpg']).toBe(0);
    expect(methods['report.json']).toBe(8);
  });

  it('prepareReport returns a ready-made .zip File that unzips correctly', async () => {
    await seed();
    const labels: string[] = [];
    const prepared = await collect.prepareReport({ includeFullPhoto: false, now: new Date(2026, 10, 4, 8, 0), onProgress: (l) => labels.push(l) });
    expect(prepared.file).toBeInstanceOf(File);
    expect(prepared.file.name).toBe('puzzle-lens-report-2026-11-04-0800.zip');
    expect(prepared.file.type).toBe('application/zip');
    expect(labels).toEqual([...collect.REPORT_STEPS]);
    const files = unzipSync(new Uint8Array(await prepared.file.arrayBuffer()));
    expect(JSON.parse(strFromU8(files['report.json']!)).deviceChecks.browser.ts).toBe(300);
    expect(files['photo/last-snap-full.jpg']).toBeUndefined();
  });
});
