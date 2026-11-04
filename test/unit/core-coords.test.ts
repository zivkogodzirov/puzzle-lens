/**
 * src/camera/coords.ts: from tracker-frame pixels (often the sensor's landscape orientation) to
 * CSS pixels inside the <video> element (object-fit: contain). Wrong here = overlay drawn in the
 * wrong place on the phone.
 */
import { describe, expect, it } from 'vitest';
import { containBox, frameRotation, frameToElement, rotatePoint, type Size } from '../../src/camera/coords';

const close = (a: [number, number], b: [number, number], digits = 6) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};

describe('frameRotation', () => {
  const land: Size = { width: 1280, height: 720 };
  const port: Size = { width: 720, height: 1280 };

  it('uses the reported rotation when it is 90, 180 or 270', () => {
    expect(frameRotation(land, port, 90)).toBe(90);
    expect(frameRotation(land, land, 180)).toBe(180);
    expect(frameRotation(land, port, 270)).toBe(270);
  });

  it('otherwise derives it: landscape frame on portrait video → 90, same orientation → 0', () => {
    expect(frameRotation(land, port)).toBe(90);
    expect(frameRotation(port, land, null)).toBe(90);
    expect(frameRotation(land, land)).toBe(0);
    expect(frameRotation(port, port, undefined)).toBe(0);
    // 0 or odd values do not override the shape check.
    expect(frameRotation(land, port, 0)).toBe(90);
    expect(frameRotation(land, land, 45)).toBe(0);
  });

  it('a square frame or video counts as not landscape', () => {
    expect(frameRotation({ width: 500, height: 500 }, port)).toBe(0);
    expect(frameRotation({ width: 500, height: 500 }, land)).toBe(90);
  });
});

describe('rotatePoint', () => {
  const f: Size = { width: 400, height: 300 };

  it('rotates the frame corners clockwise', () => {
    // 90° clockwise: the frame becomes 300 wide × 400 high; top-left goes to top-right.
    close(rotatePoint(0, 0, f, 90), [300, 0]);
    close(rotatePoint(400, 0, f, 90), [300, 400]);
    close(rotatePoint(400, 300, f, 90), [0, 400]);
    close(rotatePoint(0, 300, f, 90), [0, 0]);
    // 180°
    close(rotatePoint(0, 0, f, 180), [400, 300]);
    close(rotatePoint(100, 50, f, 180), [300, 250]);
    // 270°: top-left goes to bottom-left.
    close(rotatePoint(0, 0, f, 270), [0, 400]);
    close(rotatePoint(400, 0, f, 270), [0, 0]);
    // 0°
    close(rotatePoint(123, 45, f, 0), [123, 45]);
  });

  it('90° then 270° (on the rotated frame) is the identity; 180° twice too', () => {
    const rotated: Size = { width: f.height, height: f.width };
    for (const [x, y] of [
      [10, 20],
      [399, 1],
      [200, 150],
    ] as const) {
      const [a, b] = rotatePoint(x, y, f, 90);
      close(rotatePoint(a, b, rotated, 270), [x, y]);
      const [c, d] = rotatePoint(x, y, f, 180);
      close(rotatePoint(c, d, f, 180), [x, y]);
    }
  });

  it('four quarter turns bring a point back', () => {
    let p: [number, number] = [37, 81];
    let size: Size = f;
    for (let i = 0; i < 4; i++) {
      p = rotatePoint(p[0], p[1], size, 90);
      size = { width: size.height, height: size.width };
    }
    close(p, [37, 81]);
  });
});

describe('containBox', () => {
  it('letterboxes a landscape video in a portrait element (bars top and bottom)', () => {
    const b = containBox({ width: 1920, height: 1080 }, { width: 390, height: 844 });
    expect(b.scale).toBeCloseTo(390 / 1920, 12);
    expect(b.offsetX).toBeCloseTo(0, 12);
    expect(b.offsetY).toBeCloseTo((844 - 1080 * (390 / 1920)) / 2, 12);
  });

  it('pillarboxes a portrait video in a wide element (bars left and right)', () => {
    const b = containBox({ width: 720, height: 1280 }, { width: 1000, height: 640 });
    expect(b.scale).toBeCloseTo(0.5, 12);
    expect(b.offsetX).toBeCloseTo(320, 12);
    expect(b.offsetY).toBeCloseTo(0, 12);
  });

  it('same aspect ratio: no bars', () => {
    const b = containBox({ width: 1280, height: 720 }, { width: 640, height: 360 });
    expect(b).toEqual({ scale: 0.5, offsetX: 0, offsetY: 0 });
  });
});

describe('frameToElement', () => {
  it('same orientation, frame smaller than the video (tracker downscale)', () => {
    // Tracker frame 960×540, video 1920×1080, element 960×540 exactly.
    close(frameToElement(0, 0, { width: 960, height: 540 }, { width: 1920, height: 1080 }, { width: 960, height: 540 }), [0, 0]);
    close(frameToElement(480, 270, { width: 960, height: 540 }, { width: 1920, height: 1080 }, { width: 960, height: 540 }), [480, 270]);
    close(frameToElement(960, 540, { width: 960, height: 540 }, { width: 1920, height: 1080 }, { width: 960, height: 540 }), [960, 540]);
  });

  it('landscape sensor frame on a portrait video (phone held upright)', () => {
    const frame = { width: 1280, height: 720 };
    const video = { width: 720, height: 1280 };
    const el = { width: 390, height: 844 };
    const scale = 390 / 720;
    const top = (844 - 1280 * scale) / 2; // letterbox bar
    // Sensor top-left → top-right of the picture (90° clockwise).
    close(frameToElement(0, 0, frame, video, el), [390, top]);
    // Centre stays the centre.
    close(frameToElement(640, 360, frame, video, el), [195, 844 / 2]);
    // Sensor bottom-right → bottom-left of the picture.
    close(frameToElement(1280, 720, frame, video, el), [0, top + 1280 * scale]);
    // A point a quarter along the sensor's long side ends up a quarter down the picture.
    close(frameToElement(320, 0, frame, video, el), [390, top + 0.25 * 1280 * scale]);
  });

  it('landscape tracker frame at a different resolution than the portrait video', () => {
    // Tracker analyses 960×540; the video element reports 1080×1920.
    const frame = { width: 960, height: 540 };
    const video = { width: 1080, height: 1920 };
    const el = { width: 1080, height: 1920 };
    close(frameToElement(960, 540, frame, video, el), [0, 1920]);
    close(frameToElement(0, 540, frame, video, el), [0, 0]);
    close(frameToElement(480, 270, frame, video, el), [540, 960]);
  });

  it('honours a reported rotation (180°: upside-down)', () => {
    const f = { width: 1280, height: 720 };
    close(frameToElement(0, 0, f, f, { width: 1280, height: 720 }, 180), [1280, 720]);
    close(frameToElement(1280, 720, f, f, { width: 1280, height: 720 }, 180), [0, 0]);
  });

  it('a reported 270° maps the sensor top-left to the picture bottom-left', () => {
    const frame = { width: 1280, height: 720 };
    const video = { width: 720, height: 1280 };
    close(frameToElement(0, 0, frame, video, video, 270), [0, 1280]);
    close(frameToElement(1280, 0, frame, video, video, 270), [0, 0]);
  });
});
