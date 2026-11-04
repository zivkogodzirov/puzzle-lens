import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { parseJpegHeader } from '../../src/device/jpeg';

function makeJpeg(w: number, h: number): Uint8Array {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(120, 60, 30)';
  ctx.fillRect(0, 0, w, h);
  return new Uint8Array(canvas.toBuffer('image/jpeg', 90));
}

/** An APP1 "Exif" segment holding only the orientation tag. */
function exifSegment(orientation: number, little: boolean, type = 3): Uint8Array {
  const tiff = new Uint8Array(26);
  const dv = new DataView(tiff.buffer);
  tiff[0] = tiff[1] = little ? 0x49 : 0x4d;
  dv.setUint16(2, 42, little);
  dv.setUint32(4, 8, little); // IFD0 right after the header
  dv.setUint16(8, 1, little); // one entry
  dv.setUint16(10, 0x0112, little); // Orientation
  dv.setUint16(12, type, little); // SHORT (3) or LONG (4)
  dv.setUint32(14, 1, little); // count
  if (type === 3) dv.setUint16(18, orientation, little);
  else dv.setUint32(18, orientation, little);
  dv.setUint32(22, 0, little); // no next IFD
  const payload = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xe1, len >> 8, len & 255, ...payload]);
}

function withSegment(jpeg: Uint8Array, seg: Uint8Array): Uint8Array {
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(seg, 2);
  out.set(jpeg.subarray(2), 2 + seg.length);
  return out;
}

describe('parseJpegHeader', () => {
  it('reads the size of a real JPEG without EXIF', () => {
    const info = parseJpegHeader(makeJpeg(40, 24))!;
    expect(info).not.toBeNull();
    expect(info.width).toBe(40);
    expect(info.height).toBe(24);
    expect(info.orientation).toBe(1);
    expect(info.displayWidth).toBe(40);
    expect(info.displayHeight).toBe(24);
  });

  it('applies EXIF orientation 6 (iPhone portrait photo) in both byte orders', () => {
    for (const little of [true, false]) {
      const info = parseJpegHeader(withSegment(makeJpeg(40, 24), exifSegment(6, little)))!;
      expect(info.orientation).toBe(6);
      expect(info.width).toBe(40);
      expect(info.displayWidth).toBe(24);
      expect(info.displayHeight).toBe(40);
    }
  });

  it('keeps landscape for orientation 3 and reads LONG-typed tags', () => {
    const info = parseJpegHeader(withSegment(makeJpeg(40, 24), exifSegment(3, true, 4)))!;
    expect(info.orientation).toBe(3);
    expect(info.displayWidth).toBe(40);
  });

  it('ignores invalid orientation values', () => {
    expect(parseJpegHeader(withSegment(makeJpeg(40, 24), exifSegment(42, true)))!.orientation).toBe(1);
  });

  it('only needs the start of the file', () => {
    const jpeg = withSegment(makeJpeg(64, 48), exifSegment(8, false));
    // Cut right after the frame header: find SOF0 and keep a few bytes past it.
    let sof = -1;
    for (let i = 2; i < jpeg.length - 1; i++) if (jpeg[i] === 0xff && jpeg[i + 1] === 0xc0) sof = i;
    expect(sof).toBeGreaterThan(0);
    const info = parseJpegHeader(jpeg.subarray(0, sof + 12))!;
    expect(info.displayWidth).toBe(48);
    expect(info.displayHeight).toBe(64);
  });

  it('returns null for non-JPEG or truncated data', () => {
    expect(parseJpegHeader(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(parseJpegHeader(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(parseJpegHeader(makeJpeg(40, 24).subarray(0, 20))).toBeNull();
    expect(parseJpegHeader(new Uint8Array(0))).toBeNull();
  });
});
