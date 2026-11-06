import { describe, expect, it } from 'vitest';
import {
  applyRun,
  benchSummary,
  countByStatus,
  formatBytes,
  formatMB,
  formatMs,
  fpsFromSamples,
  gpuEntries,
  groupBySection,
  isDeviceCheckResults,
  megapixels,
  mergeChecks,
  missingParts,
  modeLabel,
  newResults,
  noiseVerdict,
  parseIosVersion,
  parseSafariVersion,
  PART_NAMES,
  partDone,
  permissionHistoryEntry,
  permissionWord,
  photoStatus,
  REQUIRED_PARTS,
  sizeText,
  statusClass,
  statusSymbol,
  statusWord,
  summarizeLaunches,
  summaryLine,
  twoXVerdict,
  verdictLine,
} from '../../src/device/format';
import { CHECK_ORDER, SECTIONS, checkDef, makeEntry } from '../../src/device/catalog';
import type { DeviceEnvironment } from '../../src/device/types';
import type { GpuProbeResult, NoiseComparison } from '../../src/shared/probeApi';
import { errorMessage, mayStopCamera, toPlain, withTimeout, TimeoutError } from '../../src/device/util';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';

const ENV: DeviceEnvironment = {
  userAgent: IPHONE_UA,
  platform: 'iPhone',
  vendor: 'Apple Computer, Inc.',
  safariVersion: '27.2',
  iosVersionInUA: '18.6',
  language: 'en-AU',
  screen: { width: 402, height: 874, availWidth: 402, availHeight: 874, orientation: 'portrait-primary' },
  viewport: { width: 402, height: 780 },
  devicePixelRatio: 3,
  hardwareConcurrency: 6,
  maxTouchPoints: 5,
  secureContext: true,
  crossOriginIsolated: false,
  standaloneFlag: true,
};

describe('status display', () => {
  it('maps every status to a symbol and a colour class', () => {
    expect(statusSymbol('yes')).toBe('✓');
    expect(statusSymbol('no')).toBe('✗');
    expect(statusSymbol('partial')).toBe('~');
    expect(statusSymbol('error')).toBe('⚠');
    expect(statusSymbol('skipped')).toBe('–');
    expect(statusSymbol('info')).toBe('ⓘ');
    expect(statusWord('info')).toBe('Normal on iPhone');
    expect(statusClass('info')).toBe('muted');
    expect(statusClass('yes')).toBe('ok');
    expect(statusClass('partial')).toBe('warn');
    expect(statusClass('no')).toBe('bad');
    expect(statusClass('error')).toBe('bad');
  });

  it('names the display modes in plain English', () => {
    expect(modeLabel('standalone')).toBe('Home Screen app');
    expect(modeLabel('browser')).toBe('Safari tab');
  });
});

describe('number formatting', () => {
  it('formats bytes, MB and milliseconds', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(15.25 * 1048576)).toBe('15.3 MB');
    expect(formatBytes(64 * 1073741824)).toBe('64.0 GB');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatMB(1344)).toBe('1,344 MB');
    expect(formatMs(3.14159)).toBe('3.1 ms');
    expect(formatMs(250.4)).toBe('250 ms');
    expect(formatMs(1500)).toBe('1.5 s');
    expect(formatMs(null)).toBe('—');
  });

  it('computes megapixels', () => {
    expect(megapixels(4032, 3024)).toBe(12.2);
    expect(megapixels(8064, 6048)).toBe(48.8);
    expect(sizeText(4032, 3024)).toBe('4032×3024 (12.2 MP)');
  });
});

describe('user agent', () => {
  it('reads Safari and iOS versions', () => {
    expect(parseSafariVersion(IPHONE_UA)).toBe('27.2');
    expect(parseIosVersion(IPHONE_UA)).toBe('18.6');
    expect(parseSafariVersion('curl/8')).toBeNull();
    expect(parseIosVersion('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBeNull();
  });
});

describe('fpsFromSamples', () => {
  it('uses presentedFrames when available', () => {
    // 2 s window, 60 frames presented but only 30 callbacks seen.
    const samples = Array.from({ length: 31 }, (_, i) => ({ t: 1000 + i * (2000 / 30), presented: 100 + i * 2 }));
    const r = fpsFromSamples(samples)!;
    expect(r.frames).toBe(60);
    expect(r.fps).toBeCloseTo(30 * 1, 0); // 60 frames / 2 s
  });

  it('falls back to counting callbacks', () => {
    const samples = Array.from({ length: 61 }, (_, i) => ({ t: i * (1000 / 30) }));
    expect(fpsFromSamples(samples)!.fps).toBeCloseTo(30, 5);
  });

  it('returns null without enough samples', () => {
    expect(fpsFromSamples([])).toBeNull();
    expect(fpsFromSamples([{ t: 5 }])).toBeNull();
    expect(fpsFromSamples([{ t: 5 }, { t: 5 }])).toBeNull();
  });
});

describe('camera permission history (WebKit bug 327237)', () => {
  const launch = (mode: 'standalone' | 'browser', cameraPermission: string, ts: number) => ({ mode, cameraPermission, ts });

  it('counts permission states per mode', () => {
    const s = summarizeLaunches([launch('standalone', 'prompt', 1), launch('standalone', 'granted', 2), launch('browser', 'granted', 3), launch('standalone', 'unknown', 4)]);
    expect(s.standalone).toEqual({ total: 3, prompt: 1, granted: 1, denied: 0, other: 1 });
    expect(s.browser).toEqual({ total: 1, prompt: 0, granted: 1, denied: 0, other: 0 });
  });

  it('flags the bug when the Home Screen app keeps asking', () => {
    const rows = [1, 2, 3, 4].map((t) => launch('standalone', 'prompt', t));
    const e = permissionHistoryEntry(rows);
    expect(e.status).toBe('partial');
    expect(e.value).toBe('Asked again at 4 of 4 launches');
    expect(e.section).toBe('camera');
  });

  it('is fine when only the first launch asked', () => {
    const e = permissionHistoryEntry([launch('standalone', 'prompt', 1), launch('standalone', 'granted', 2), launch('standalone', 'granted', 3)]);
    expect(e.status).toBe('yes');
    expect(e.value).toBe('Asked again at 1 of 3 launches');
  });

  it('is skipped without Home Screen launches', () => {
    expect(permissionHistoryEntry([launch('browser', 'prompt', 1)]).status).toBe('skipped');
    expect(permissionHistoryEntry([launch('standalone', 'unknown', 1)]).status).toBe('skipped');
  });

  it('words permission states plainly', () => {
    expect(permissionWord('granted')).toBe('Allowed');
    expect(permissionWord('prompt')).toBe('Will ask');
    expect(permissionWord('denied')).toBe('Blocked');
    expect(permissionWord('unknown')).toBe("Can't tell");
  });
});

describe('verdicts', () => {
  it('judges the 2× test from the ratio measured on the owner\'s iPhone, never with a ✗', () => {
    const base = { oneXSize: [4032, 3024] as [number, number], twoXSize: [4032, 3024] as [number, number] };
    // The reader's own label is ignored; only the ratio counts.
    for (const verdict of ['true-2x', 'digital-zoom', 'unclear'] as const) {
      expect(twoXVerdict({ ...base, ratio: 1.83, verdict })).toEqual({ status: 'yes', value: 'True 2× lens — close-ups at 2× are sharp (ratio 1.83)' });
      expect(twoXVerdict({ ...base, ratio: 1.054, verdict })).toEqual({ status: 'partial', value: 'Not confirmed (ratio 1.05) — close-ups will be taken at 1× from closer' });
    }
    expect(twoXVerdict({ ...base, ratio: 2.4, verdict: 'unclear' }).status).toBe('yes');
    expect(twoXVerdict({ ...base, ratio: Number.NaN, verdict: 'unclear' }).value).toContain('Could not measure');
    expect(twoXVerdict({ ...base, ratio: 0, verdict: 'unclear' }).status).toBe('partial');
  });

  it('words the canvas-noise result', () => {
    const cmp = (verdict: NoiseComparison['verdict']): NoiseComparison => ({
      exact: { checked: 1, mismatched: 0, maxDiff: 0 },
      gradient: { checked: 1, mismatched: 0, maxDiff: 0 },
      textPixels: 10,
      verdict,
      samples: [],
    });
    expect(noiseVerdict(cmp('clean'))).toEqual({ status: 'yes', value: 'No noise' });
    expect(noiseVerdict(cmp('noise'))).toEqual({ status: 'partial', value: 'Noise detected (Safari fingerprinting protection)' });
    expect(noiseVerdict(cmp('maybe')).status).toBe('partial');
    expect(noiseVerdict(null, 'boom')).toEqual({ status: 'error', value: 'boom' });
  });

  it('summarises the OpenCV benchmark against the 25 ms live-frame budget', () => {
    const fast = benchSummary({ loadMs: 800, wasmBytesAfter: 0, stages: [{ name: 'Blur 5×5', size: '1920×1080', ms: 4 }, { name: 'Live frame (shrink + markers + sharpness)', size: '', ms: 12 }] });
    expect(fast.status).toBe('yes');
    expect(fast.value).toBe('live frame 12 ms · 2 steps in 16 ms');
    const slow = benchSummary({ loadMs: 800, wasmBytesAfter: 0, stages: [{ name: 'Live frame (shrink + markers + sharpness)', size: '', ms: 40 }] });
    expect(slow.status).toBe('partial');
    expect(benchSummary({ loadMs: 0, wasmBytesAfter: 0, stages: [] }).status).toBe('error');
  });

  it('judges photo sizes against the requested size in either orientation', () => {
    expect(photoStatus({ imageWidth: 4032, imageHeight: 3024 }, 4032, 3024)).toBe('yes');
    expect(photoStatus({ imageWidth: 4032, imageHeight: 3024 }, 3024, 4032)).toBe('yes');
    expect(photoStatus({ imageWidth: 4032, imageHeight: 3024 }, 1920, 1440)).toBe('partial');
    expect(photoStatus(null, 640, 480)).toBe('yes');
  });
});

describe('gpuEntries', () => {
  const base: GpuProbeResult = {
    where: 'main',
    available: true,
    adapter: true,
    adapterTimedOut: false,
    adapterMs: 12,
    info: { vendor: 'apple', architecture: 'common-3' },
    limits: { maxBufferSize: 1073741824, maxStorageBufferBindingSize: 1073741824, maxComputeWorkgroupStorageSize: 32768, maxComputeInvocationsPerWorkgroup: 1024 },
    features: ['shader-f16'],
    f16: true,
    f16Enabled: true,
    device: true,
    compute: { ok: true, n: 256, reps: 20, firstMs: 30, msPerRun: 0.5, gflops: 67.1, checked: 1024, wrong: 0 },
    totalMs: 50,
  };
  const byId = (list: ReturnType<typeof gpuEntries>) => Object.fromEntries(list.map((e) => [e.id, e]));

  it('reports a working GPU', () => {
    const r = byId(gpuEntries(base, { ...base, where: 'worker' }));
    expect(r['webgpu-adapter']!.status).toBe('yes');
    expect(r['webgpu-adapter']!.value).toBe('apple · common-3');
    expect(r['webgpu-limits']!.value).toBe('buffer 1024 MB · storage 1024 MB · group memory 32 KB · 1024 threads');
    expect(r['webgpu-f16']!.status).toBe('yes');
    expect(r['webgpu-device']!.status).toBe('yes');
    expect(r['webgpu-compute-main']!.status).toBe('yes');
    expect(r['webgpu-compute-main']!.value).toContain('67 GFLOP/s');
    expect(r['webgpu-compute-worker']!.status).toBe('yes');
  });

  it('reports no WebGPU as "no", not as an error', () => {
    const none: GpuProbeResult = { ...base, available: false, adapter: false, info: null, limits: null, features: [], f16: false, f16Enabled: false, device: false, compute: null };
    const r = byId(gpuEntries(none, null, 'worker failed'));
    expect(r['webgpu-adapter']!.status).toBe('no');
    expect(r['webgpu-limits']!.status).toBe('skipped');
    expect(r['webgpu-compute-main']!.status).toBe('no');
    expect(r['webgpu-compute-worker']!.status).toBe('error');
    expect(r['webgpu-compute-worker']!.value).toBe('worker failed');
  });

  it('flags wrong GPU results and adapter timeouts', () => {
    const wrong = { ...base, compute: { ...base.compute!, ok: false, wrong: 3 } };
    expect(byId(gpuEntries(wrong, null))['webgpu-compute-main']!.status).toBe('error');
    const slow = { ...base, adapter: false, adapterTimedOut: true, device: false, compute: null };
    expect(byId(gpuEntries(slow, null))['webgpu-adapter']!.value).toBe('No answer within 3 s');
  });
});

describe('catalog and results', () => {
  it('has unique ids, all in known sections', () => {
    expect(new Set(CHECK_ORDER).size).toBe(CHECK_ORDER.length);
    const sectionIds = new Set(SECTIONS.map((s) => s.id));
    for (const id of CHECK_ORDER) expect(sectionIds.has(checkDef(id).section)).toBe(true);
    expect(SECTIONS.map((s) => s.title)).toEqual(['Basics', 'Camera', 'Photos (Snap)', 'Graphics & speed', 'Storage & offline', 'Other']);
  });

  it('builds entries with JSON-safe details', () => {
    const e = makeEntry('wake-lock', 'yes', 'Works', { fn: () => 1, err: new Error('x'), n: 1 });
    expect(e).toEqual({ id: 'wake-lock', section: 'other', label: 'Keep the screen awake', status: 'yes', value: 'Works', details: { err: { name: 'Error', message: 'x' }, n: 1 } });
    expect('details' in makeEntry('wake-lock', 'yes', 'Works')).toBe(false);
    expect(makeEntry('unknown-id', 'yes', 'x').section).toBe('other');
  });

  it('merges runs: replaces by id and keeps display order', () => {
    const a = [makeEntry('wake-lock', 'no', 'old'), makeEntry('secure-context', 'yes', 'Yes')];
    const merged = mergeChecks(a, [makeEntry('wake-lock', 'yes', 'new'), makeEntry('getusermedia', 'yes', 'Available')]);
    expect(merged.map((c) => c.id)).toEqual(['secure-context', 'getusermedia', 'wake-lock']);
    expect(merged.find((c) => c.id === 'wake-lock')!.value).toBe('new');
  });

  it('groups by section in the fixed order and counts statuses', () => {
    const checks = [makeEntry('wake-lock', 'yes', ''), makeEntry('secure-context', 'yes', ''), makeEntry('webgpu-adapter', 'no', ''), makeEntry('opfs', 'error', '')];
    expect(groupBySection(mergeChecks([], checks)).map((s) => s.title)).toEqual(['Basics', 'Graphics & speed', 'Storage & offline', 'Other']);
    expect(countByStatus(checks)).toEqual({ yes: 2, no: 1, partial: 0, error: 1, skipped: 0, info: 0 });
    expect(summaryLine(checks)).toBe('4 checks: 2 working, 1 not available, 1 test failed');
    const more = [...checks, makeEntry('camera-controls', 'info', ''), makeEntry('storage-persist', 'partial', ''), makeEntry('photo-48mp', 'skipped', '')];
    expect(summaryLine(more)).toBe('7 checks: 2 working, 1 limited, 1 not available, 1 test failed, 1 normal on iPhone, 1 not run');
    expect(summaryLine([makeEntry('wake-lock', 'yes', '')])).toBe('1 check: 1 working');
  });

  it('gives a one-line plain verdict', () => {
    expect(verdictLine([makeEntry('wake-lock', 'yes', ''), makeEntry('camera-controls', 'info', '')])).toEqual({
      tone: 'good',
      text: 'Everything Puzzle Lens needs works.',
    });
    expect(verdictLine([makeEntry('wake-lock', 'yes', ''), makeEntry('storage-persist', 'partial', '')]).tone).toBe('warn');
    const bad = verdictLine([
      makeEntry('webgpu-adapter', 'no', ''),
      makeEntry('opfs', 'error', ''),
      makeEntry('wake-lock', 'no', ''),
      makeEntry('indexeddb', 'error', ''),
      makeEntry('secure-context', 'yes', ''),
    ]);
    expect(bad.tone).toBe('bad');
    expect(bad.text).toBe(
      '4 things need attention: Graphics chip for maths (WebGPU), Private file storage (OPFS), Keep the screen awake and 1 more. Nothing for you to fix — just send a report.',
    );
    expect(verdictLine([makeEntry('opfs', 'error', '')]).text).toMatch(/^1 thing needs attention: Private file storage/);
    expect(verdictLine([]).tone).toBe('warn');
  });

  it('knows which steps of a full check are done', () => {
    const r0 = newResults('1', 'browser', ENV, 100);
    expect(missingParts(r0)).toEqual(['automatic', 'camera', 'fileCamera', 'photoProbe']);
    expect(missingParts(null)).toEqual(['automatic', 'camera', 'fileCamera', 'photoProbe']);
    // Camera tests that only produced errors (e.g. permission refused) don't count as done.
    const refused = applyRun(r0, [makeEntry('camera-format-auto-4x3', 'error', 'refused')], 'camera', 200);
    expect(partDone(refused, 'camera')).toBe(false);
    const three = applyRun(
      applyRun(applyRun(refused, [makeEntry('opfs', 'yes', '')], 'automatic', 300), [makeEntry('camera-format-4k', 'yes', '')], 'camera', 400),
      [makeEntry('file-camera', 'yes', '')],
      'fileCamera',
      500,
    );
    expect(missingParts(three)).toEqual(['photoProbe']);
    const all = applyRun(three, [makeEntry('photo-probe-choice', 'partial', 'Snap will use: Full-size live picture')], 'photoProbe', 600);
    expect(missingParts(all)).toEqual([]);
    expect(partDone(all, 'memory')).toBe(false);
    expect(REQUIRED_PARTS).toEqual(['automatic', 'camera', 'fileCamera', 'photoProbe']);
    expect(PART_NAMES.memory).toMatch(/optional/);
  });

  it('applies a run without changing the old results', () => {
    const r0 = newResults('1.0', 'browser', ENV, 100);
    const r1 = applyRun(r0, [makeEntry('opfs', 'yes', 'Available')], 'automatic', 200);
    expect(r0.checks).toHaveLength(0);
    expect(r1.checks).toHaveLength(1);
    expect(r1.checks[0]?.appVersion).toBe('1.0');
    expect(r1.parts).toEqual({ automatic: 200 });
    expect(r1.ts).toBe(200);
    const r2 = applyRun(r1, [makeEntry('memory-headroom', 'yes', 'x')], 'memory', 300);
    expect(r2.parts).toEqual({ automatic: 200, memory: 300 });
    expect(r2.checks.map((c) => c.id)).toEqual(['opfs', 'memory-headroom']);
    expect(isDeviceCheckResults(r2)).toBe(true);
    expect(isDeviceCheckResults({ schema: 2 })).toBe(false);
    expect(isDeviceCheckResults(null)).toBe(false);
  });
});

describe('util', () => {
  it('reads error messages from anything', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage({ name: 'NotAllowedError', message: 'denied' })).toBe('NotAllowedError: denied');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(null)).toBe('Unknown error');
  });

  it('times out slow promises', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'Waiting')).rejects.toBeInstanceOf(TimeoutError);
    await expect(withTimeout(Promise.resolve(5), 20, 'Waiting')).resolves.toBe(5);
  });

  it("only lets an aborted camera test stop a camera it started itself", () => {
    const mine = { id: 'mine' };
    const lives = { id: 'live screen' };
    const own = new Set([mine]);
    expect(mayStopCamera(false, lives, own)).toBe(true); // finished normally: always clean up
    expect(mayStopCamera(true, mine, own)).toBe(true);
    expect(mayStopCamera(true, null, own)).toBe(true);
    expect(mayStopCamera(true, lives, own)).toBe(false); // Live started its own camera meanwhile
  });

  it('cuts cycles when making details plain', () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    expect(toPlain(o)).toEqual({ a: 1, self: '[circular]' });
  });
});
