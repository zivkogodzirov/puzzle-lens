/**
 * Outlines found only in part (src/cv/scanMarkerless.ts PART_OUTLINE): a single piece much smaller
 * than the photo's other single pieces is marked `part` and `weak`; its sides are not read.
 */
import { describe, expect, it } from 'vitest';
import { flagPartOutlines, PART_OUTLINE } from '../../src/cv/scanMarkerless';
import { readPiece } from '../../src/cv/readPiece';
import type { PieceFlags } from '../../src/project/types';

const piece = (areaMm2: number, flags: PieceFlags = {}) => ({ areaMm2, flags });

describe('flagPartOutlines', () => {
  const whole = Array.from({ length: 10 }, (_, i) => piece(280 + 4 * i));
  it('marks a single piece well under the median, and only that one', () => {
    const out = flagPartOutlines([...whole, piece(40), piece(0.65 * 290)]);
    expect(out.filter((p) => p.flags.part).map((p) => p.areaMm2)).toEqual([40]);
    expect(out.find((p) => p.areaMm2 === 40)!.flags).toEqual({ weak: true, part: true });
  });
  it('leaves clumps, cut and already-weak pieces alone', () => {
    const out = flagPartOutlines([...whole, piece(40, { clump: true }), piece(40, { cut: true }), piece(40, { weak: true })]);
    expect(out.some((p) => p.flags.part)).toBe(false);
  });
  it('needs enough single pieces for the median', () => {
    const few = whole.slice(0, PART_OUTLINE.minSingles - 2);
    expect(flagPartOutlines([...few, piece(40)]).some((p) => p.flags.part)).toBe(false);
  });
  it('a tilted photo: whole pieces at 0.68 of the median are not marked (IMG_9224)', () => {
    expect(flagPartOutlines([...whole, piece(0.68 * 298)]).some((p) => p.flags.part)).toBe(false);
  });
});

describe('readPiece of an outline found only in part', () => {
  it('keeps the picture, reads no sides', () => {
    const w = 120;
    const data = new Uint8ClampedArray(w * w * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 255));
    const photo = { data, width: w, height: w, stride: w * 4 };
    const sq: number[] = [];
    for (let t = 0; t < 40; t++) sq.push(30 + 1.5 * t, 30);
    for (let t = 0; t < 40; t++) sq.push(90, 30 + 1.5 * t);
    for (let t = 0; t < 40; t++) sq.push(90 - 1.5 * t, 90);
    for (let t = 0; t < 40; t++) sq.push(30, 90 - 1.5 * t);
    const full = readPiece(photo, { outlineImg: sq, flags: {} }, 3);
    const part = readPiece(photo, { outlineImg: sq, flags: { part: true } }, 3);
    expect(full).not.toBeNull();
    expect(part).not.toBeNull();
    expect(part!.sure).toBe(false);
    expect(part!.flats).toEqual([false, false, false, false]);
    expect(part!.sides).toBe('uuuu');
    expect(part!.sideConf).toEqual([0, 0, 0, 0]);
    expect(part!.fp).toEqual(full!.fp);
  });
});
