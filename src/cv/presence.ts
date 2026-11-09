/**
 * Is a known piece still at its spot? (M5 part 4: the live view notices pieces moved since the
 * scan.) A piece stands out from the table around it: its print is darker or lighter and has
 * texture, while an empty spot looks like the table just outside it. Each piece is compared with
 * how much it stood out in the scan photo itself, so pale pieces that hardly stand out on a white
 * table are never called gone (they are "unknown" instead).
 */
import { applyH } from '../geo/homography';
import type { Mat3 } from '../project/types';

export const PRESENCE = {
  /** Below this contrast in the scan photo (grey levels) a piece can't be judged. */
  minBase: 14,
  /** Gone: contrast now below this share of the scan photo's. */
  goneShare: 0.4,
  /** There: at least this share. */
  thereShare: 0.6,
  /** Outside samples this far beyond the outline (mm). */
  ringMm: 3,
};

export interface GreyImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  stride: number;
}

/** A piece's outline on the table (mm, absolute, flat x, y). */
export interface PresencePiece {
  id: string;
  outline: number[];
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]!;

/**
 * How much the piece stands out where `tableToImg` puts it in `img` (grey levels): the difference
 * between the median grey inside its outline and just outside it, plus the spread inside (print
 * texture). Null when part of it is outside the picture.
 */
export function pieceContrast(img: GreyImage, tableToImg: Mat3, piece: PresencePiece, pxPerMm: number): number | null {
  const o = piece.outline;
  const n = o.length / 2;
  if (n < 3) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += o[2 * i]!;
    cy += o[2 * i + 1]!;
  }
  cx /= n;
  cy /= n;
  const at = (x: number, y: number): number | null => {
    const p = applyH(tableToImg, [x, y]);
    const X = Math.round(p[0]);
    const Y = Math.round(p[1]);
    if (!(X >= 0 && Y >= 0 && X < img.width && Y < img.height)) return null;
    return img.data[Y * img.stride + X]!;
  };
  const inside: number[] = [];
  const outside: number[] = [];
  const step = Math.max(1, Math.floor(n / 16));
  const c = at(cx, cy);
  if (c === null) return null;
  inside.push(c);
  for (let i = 0; i < n; i += step) {
    const dx = o[2 * i]! - cx;
    const dy = o[2 * i + 1]! - cy;
    const r = Math.hypot(dx, dy);
    if (r < 1e-6) continue;
    for (const t of [0.35, 0.65]) {
      const v = at(cx + dx * t, cy + dy * t);
      if (v === null) return null;
      inside.push(v);
    }
    const k = 1 + PRESENCE.ringMm / r;
    const v = at(cx + dx * k, cy + dy * k);
    if (v === null) return null;
    outside.push(v);
  }
  if (inside.length < 8 || outside.length < 4) return null;
  void pxPerMm;
  const mIn = median(inside);
  const mean = inside.reduce((a, b) => a + b, 0) / inside.length;
  const sd = Math.sqrt(inside.reduce((a, b) => a + (b - mean) ** 2, 0) / inside.length);
  return Math.abs(mIn - median(outside)) + sd;
}

export type Presence = 'there' | 'gone' | 'unknown';

/** Judges one piece now against its contrast in the scan photo. */
export function judgePresence(now: number | null, base: number | undefined): Presence {
  if (now === null || base === undefined || base < PRESENCE.minBase) return 'unknown';
  if (now < PRESENCE.goneShare * base) return 'gone';
  if (now >= PRESENCE.thereShare * base) return 'there';
  return 'unknown';
}
