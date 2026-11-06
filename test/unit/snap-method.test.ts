/** How Snap takes its picture: the Photo test's choice and the sizes it asks for (src/camera/snapMethod.ts, src/device/photoProbe.ts). */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/camera/camera', () => ({}));
vi.mock('../../src/camera/framePump', () => ({}));
vi.mock('../../src/camera/snap', () => ({}));
vi.mock('../../src/app/settings', () => ({ settings: { snapMethod: { value: '' } } }));
vi.mock('../../src/app/workers', () => ({ Comlink: {}, readerWorker: () => null }));
vi.mock('../../src/device/cameraChecks', () => ({}));
vi.mock('../../src/log/logger', () => ({ logInfo: () => {} }));

const { describeSnapMethod, parseSnapMethod, photoSizeFor } = await import('../../src/camera/snapMethod');
const { chooseSnapMethod } = await import('../../src/device/photoProbe');

const take = (size: 'none' | 'as-delivered' | 'landscape', onClone = false) => ({ kind: 'takePhoto' as const, size, pauseTracking: false, onClone });

describe('photo sizes', () => {
  const delivered = { width: 3024, height: 4032 }; // what the owner's iPhone delivered (upright)
  it('asks for the size as delivered, sideways, the largest offered, or nothing', () => {
    expect(photoSizeFor('none', delivered, null, null)).toBeNull();
    expect(photoSizeFor('as-delivered', delivered, null, null)).toEqual({ imageWidth: 3024, imageHeight: 4032 });
    expect(photoSizeFor('landscape', delivered, null, null)).toEqual({ imageWidth: 4032, imageHeight: 3024 });
    expect(photoSizeFor('caps-max', delivered, { imageWidth: { max: 8064 }, imageHeight: { max: 6048 } }, null)).toEqual({ imageWidth: 8064, imageHeight: 6048 });
    expect(photoSizeFor('camera-default', delivered, null, { imageWidth: 4032, imageHeight: 3024 })).toEqual({ imageWidth: 4032, imageHeight: 3024 });
    expect(photoSizeFor('caps-max', delivered, null, null)).toBeNull();
  });
});

describe('the saved choice', () => {
  it('round-trips and rejects junk', () => {
    const m = take('as-delivered');
    expect(parseSnapMethod(JSON.stringify(m))).toEqual(m);
    expect(parseSnapMethod('')).toBeNull();
    expect(parseSnapMethod('{"kind":"nope"}')).toBeNull();
    expect(parseSnapMethod('not json')).toBeNull();
    expect(describeSnapMethod(null)).toBe('Automatic');
    expect(describeSnapMethod({ kind: 'grabFrame' })).toMatch(/live picture/);
  });
});

describe('choosing how Snap works', () => {
  const ok = (id: string, method: ReturnType<typeof take>, pixels: number) => ({ id, method, ok: true, pixels });
  const bad = (id: string, method: ReturnType<typeof take>) => ({ id, method, ok: false, pixels: 0 });
  const FULL = 3024 * 4032;
  const SMALL = 540 * 960;
  const grab = { ok: true, pixels: FULL };

  it('prefers keeping tracking on (full-size copy first), but only with a full-size photo', () => {
    expect(chooseSnapMethod({ onFull: [ok('f', take('none'), FULL)], on: [ok('o', take('none'), FULL)], grab })).toEqual({
      ...take('none'),
      pauseTracking: false,
      fullSizeTracking: true,
      restartCamera: false,
    });
    expect(chooseSnapMethod({ onFull: [bad('f', take('none'))], on: [ok('a', take('none'), 12e6), ok('b', take('landscape'), 48e6)], grab })).toEqual({
      ...take('landscape'),
      pauseTracking: false,
      fullSizeTracking: false,
      restartCamera: false,
    });
  });

  it("the owner's iPhone, 2026-11-06: small with tracking on, small when only paused → restart the camera", () => {
    const c = chooseSnapMethod({
      onFull: [bad('f', take('none'))],
      on: [ok('o', take('none'), SMALL)],
      paused: [ok('p', take('none'), SMALL)],
      restart: [ok('r', take('none'), FULL)],
      grab,
    });
    expect(c).toEqual({ ...take('none'), pauseTracking: true, fullSizeTracking: false, restartCamera: true });
  });

  it('pausing alone is preferred to restarting when it gives a full-size photo', () => {
    const c = chooseSnapMethod({ on: [ok('o', take('none'), SMALL)], paused: [ok('p', take('none'), FULL)], restart: [ok('r', take('none'), FULL)], grab });
    expect(c).toEqual({ ...take('none'), pauseTracking: true, fullSizeTracking: false, restartCamera: false });
  });

  it('uses the full-size live picture when no full-size photo works', () => {
    expect(chooseSnapMethod({ on: [ok('o', take('none'), SMALL)], paused: [bad('p', take('none'))], restart: [bad('r', take('none'))], grab })).toEqual({ kind: 'grabFrame' });
  });

  it("falls back to the iPhone's camera screen when nothing works", () => {
    expect(chooseSnapMethod({ on: [], paused: [bad('b', take('none'))], grab: { ok: false, pixels: 0 } })).toEqual({ kind: 'file' });
  });
});
