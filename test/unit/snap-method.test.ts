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

  it('prefers a photo that works with tracking on, the biggest one', () => {
    const c = chooseSnapMethod([ok('a', take('none'), 12e6), ok('b', take('landscape'), 48e6)], [], { ok: true, pixels: 12e6 });
    expect(c).toEqual({ ...take('landscape'), pauseTracking: false });
  });

  it('pauses tracking when photos only work with tracking off (and beat the live picture)', () => {
    const c = chooseSnapMethod([bad('a', take('none'))], [ok('b', take('as-delivered'), 24e6)], { ok: true, pixels: 12e6 });
    expect(c).toEqual({ ...take('as-delivered'), pauseTracking: true });
  });

  it("uses the full-size live picture when no photo works (the owner's iPhone on 2026-11-06)", () => {
    expect(chooseSnapMethod([bad('a', take('none'))], [bad('b', take('none'))], { ok: true, pixels: 12.2e6 })).toEqual({ kind: 'grabFrame' });
  });

  it("falls back to the iPhone's camera screen when nothing works", () => {
    expect(chooseSnapMethod([], [bad('b', take('none'))], { ok: false, pixels: 0 })).toEqual({ kind: 'file' });
  });
});
