/**
 * Colour groups for sorting into trays (M4; RESEARCH §9.8): each piece's main colour, and the pieces
 * grouped by it (one group per tray).
 *
 * Why colour and not zones of the box picture: a zone needs each piece's spot on the box picture,
 * and on real photos that was right for only ~60 % of spots cut from the owner's finished puzzle
 * and ~40 % of their loose pieces (6 zones). A piece's own colours are measured reliably; puzzlers
 * sort by them anyway. Where a group's colours are on the box picture isn't shown: the pieces' photo
 * and the box photo differ too much in colour (RESEARCH §9.8).
 *
 * Pure functions (no DOM): shared by the screens and the tests.
 */
import { labImage, PATCH_SIZE } from './placement';

export type Lab = [number, number, number];

export const GROUPS = {
  min: 2,
  max: 12,
  default: 6,
  /**
   * Lightness counts this much against colour (a, b) in colour distances: shine and shading change a
   * piece's lightness across its face far more than its hue. 0.4 kept the owner's 11 wall pieces in
   * one group at 4 and 6 trays with the light evened out (0.6 split them in two, 0.3 at 6 trays).
   */
  lWeight: 0.4,
  /** Two colours of one piece closer than this (weighted ΔE) are one colour. */
  sameColour: 8,
  /** A piece's second colour covering at least this share is mentioned ("also B"). */
  alsoShare: 0.35,
};

/** Weighted squared colour distance. */
export function dist2(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const dl = (a[0]! - b[0]!) * GROUPS.lWeight;
  const da = a[1]! - b[1]!;
  const db = a[2]! - b[2]!;
  return dl * dl + da * da + db * db;
}

export interface PieceColours {
  /** The colour covering most of the piece. */
  main: Lab;
  mainShare: number;
  /** A second colour, when the piece clearly has two. */
  second: Lab | null;
  secondShare: number;
}

/**
 * A piece's main colour (and a second one) from its straightened patch (RGBA, alpha 255 = piece):
 * the piece's pixels split into two colours (2-means), the larger one first.
 */
export function pieceColours(rgba: Uint8Array, size = PATCH_SIZE): PieceColours | null {
  const lab = labImage({ data: rgba, width: size, height: size, stride: size * 4 }, size, size);
  const px: number[] = [];
  for (let y = 0; y < size; y += 2)
    for (let x = 0; x < size; x += 2)
      if (rgba[(y * size + x) * 4 + 3]! >= 128) px.push(lab[(y * size + x) * 3]!, lab[(y * size + x) * 3 + 1]!, lab[(y * size + x) * 3 + 2]!);
  const n = px.length / 3;
  if (n < 20) return null;
  const pixels = Float32Array.from(px);
  const mean: Lab = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c]! += pixels[i * 3 + c]! / n;
  // Start from the pixel farthest from the mean, and the one farthest from that.
  const far = (from: ArrayLike<number>): Lab => {
    let best = 0;
    let bi = 0;
    for (let i = 0; i < n; i++) {
      const d = dist2(pixels.subarray(i * 3, i * 3 + 3), from);
      if (d > best) ((best = d), (bi = i));
    }
    return [pixels[bi * 3]!, pixels[bi * 3 + 1]!, pixels[bi * 3 + 2]!];
  };
  let c0 = far(mean);
  let c1 = far(c0);
  let n0 = 0;
  for (let it = 0; it < 10; it++) {
    const s0: Lab = [0, 0, 0];
    const s1: Lab = [0, 0, 0];
    n0 = 0;
    for (let i = 0; i < n; i++) {
      const p = pixels.subarray(i * 3, i * 3 + 3);
      const to0 = dist2(p, c0) <= dist2(p, c1);
      const s = to0 ? s0 : s1;
      for (let c = 0; c < 3; c++) s[c]! += p[c]!;
      if (to0) n0++;
    }
    if (!n0 || n0 === n) break;
    c0 = s0.map((v) => v / n0) as Lab;
    c1 = s1.map((v) => v / (n - n0)) as Lab;
  }
  if (!n0 || n0 === n || Math.sqrt(dist2(c0, c1)) < GROUPS.sameColour) return { main: mean, mainShare: 1, second: null, secondShare: 0 };
  const [main, second, nm] = n0 >= n - n0 ? [c0, c1, n0] : [c1, c0, n - n0];
  return { main, mainShare: nm / n, second, secondShare: 1 - nm / n };
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/**
 * Groups pieces by their main colours into `count` groups (k-means, the best of a few seeded
 * starts): returns each group's colour, darkest first (so letters follow lightness: A = darkest).
 * Fewer groups than asked when there are fewer distinct colours.
 */
export function groupColours(mains: Lab[], count: number): Lab[] {
  const pts = mains.filter((m) => m.every(Number.isFinite));
  const k = Math.max(1, Math.min(Math.round(count), pts.length));
  if (!pts.length) return [];
  let best: { centres: Lab[]; cost: number } | null = null;
  for (let start = 0; start < 5; start++) {
    const r = rng(1 + start * 7919);
    // k-means++ start.
    const centres: Lab[] = [pts[Math.floor(r() * pts.length)]!.slice() as Lab];
    const d = pts.map((p) => dist2(p, centres[0]!));
    while (centres.length < k) {
      const tot = d.reduce((a, b) => a + b, 0);
      if (tot <= 0) break;
      let x = r() * tot;
      let i = 0;
      while (i < pts.length - 1 && (x -= d[i]!) > 0) i++;
      centres.push(pts[i]!.slice() as Lab);
      for (let j = 0; j < pts.length; j++) d[j] = Math.min(d[j]!, dist2(pts[j]!, centres[centres.length - 1]!));
    }
    let cost = 0;
    for (let it = 0; it < 40; it++) {
      const sum = centres.map(() => [0, 0, 0, 0]);
      cost = 0;
      for (const p of pts) {
        const g = nearest(centres, p);
        cost += g.d2;
        const s = sum[g.group]!;
        s[0]! += p[0];
        s[1]! += p[1];
        s[2]! += p[2];
        s[3]!++;
      }
      let moved = false;
      sum.forEach((s, g) => {
        if (!s[3]) return;
        const c: Lab = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
        if (dist2(c, centres[g]!) > 1e-6) moved = true;
        centres[g] = c;
      });
      if (!moved) break;
    }
    if (!best || cost < best.cost - 1e-9) best = { centres, cost };
  }
  return best!.centres.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

export function nearest(centres: ArrayLike<number>[], lab: ArrayLike<number>): { group: number; d2: number } {
  let group = 0;
  let d2 = Infinity;
  centres.forEach((c, g) => {
    const d = dist2(c, lab);
    if (d < d2) ((d2 = d), (group = g));
  });
  return { group, d2 };
}

/** A piece's group (by its main colour), and the group of its second colour when that differs and covers enough of it. */
export function pieceGroup(centres: Lab[], pc: Pick<PieceColours, 'main' | 'second' | 'secondShare'>): { group: number; also: number | null } {
  const group = nearest(centres, pc.main).group;
  const also = pc.second && pc.secondShare >= GROUPS.alsoShare ? nearest(centres, pc.second).group : null;
  return { group, also: also === group ? null : also };
}

/** Lab → sRGB hex, for showing a group's colour. */
export function labToHex(lab: ArrayLike<number>): string {
  const fy = (lab[0]! + 16) / 116;
  const fx = fy + lab[1]! / 500;
  const fz = fy - lab[2]! / 200;
  const inv = (t: number) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29));
  const X = 0.95047 * inv(fx);
  const Y = inv(fy);
  const Z = 1.08883 * inv(fz);
  const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
  return (
    '#' +
    lin
      .map((v) => {
        const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
        return Math.round(255 * Math.max(0, Math.min(1, s)))
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

/** Black or white text on a group's colour. */
export function inkOn(lab: ArrayLike<number>): '#000' | '#fff' {
  return lab[0]! >= 60 ? '#000' : '#fff';
}

export const GROUP_LETTERS = 'ABCDEFGHIJKL';

/** sRGB 0–255 → linear 0–1. */
function toLinear(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function toSrgb(v: number): number {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, 255 * s));
}

/**
 * The table's colour right around a piece in its photo (sRGB 0–255): samples 2–4 mm outside the
 * outline, along each outline point's outward direction, keeping those close to their median (a
 * neighbouring piece or a shadow is dropped). Null when too few samples fall on the table.
 */
export function tableAround(
  photo: { data: ArrayLike<number>; width: number; height: number; stride: number },
  outline0: ArrayLike<number>,
  pxPerMm: number,
): [number, number, number] | null {
  // A sparse outline (few corners) gets points along its sides, about every millimetre.
  let outline: ArrayLike<number> = outline0;
  const n0 = outline0.length / 2;
  if (n0 < 3) return null;
  if (n0 < 60) {
    const dense: number[] = [];
    for (let i = 0; i < n0; i++) {
      const [x0, y0, x1, y1] = [outline0[2 * i]!, outline0[2 * i + 1]!, outline0[(2 * i + 2) % (2 * n0)]!, outline0[(2 * i + 3) % (2 * n0)]!];
      const parts = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, pxPerMm)));
      for (let t = 0; t < parts; t++) dense.push(x0 + ((x1 - x0) * t) / parts, y0 + ((y1 - y0) * t) / parts);
    }
    outline = dense;
  }
  const n = outline.length / 2;
  if (n < 8) return null;
  // Outward = left or right of the walking direction, by the outline's orientation (signed area).
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += outline[2 * j]! * outline[2 * i + 1]! - outline[2 * i]! * outline[2 * j + 1]!;
  const sign = area > 0 ? 1 : -1;
  const step = Math.max(1, Math.floor(n / 120));
  const samples: number[][] = [];
  for (let i = 0; i < n; i += step) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const tx = outline[2 * b]! - outline[2 * a]!;
    const ty = outline[2 * b + 1]! - outline[2 * a + 1]!;
    const len = Math.hypot(tx, ty);
    if (!len) continue;
    // With y down, (ty, −tx) points outward for a positive (clockwise on screen) area.
    const nx = (sign * ty) / len;
    const ny = (-sign * tx) / len;
    for (const mm of [2, 3, 4]) {
      const x = Math.round(outline[2 * i]! + nx * mm * pxPerMm);
      const y = Math.round(outline[2 * i + 1]! + ny * mm * pxPerMm);
      if (x < 0 || y < 0 || x >= photo.width || y >= photo.height) continue;
      const k = y * photo.stride + x * 4;
      samples.push([photo.data[k]!, photo.data[k + 1]!, photo.data[k + 2]!]);
    }
  }
  if (samples.length < 30) return null;
  const med = [0, 1, 2].map((c) => samples.map((s) => s[c]!).sort((p, q) => p - q)[samples.length >> 1]!);
  const keep = samples.filter((s) => Math.abs(s[0]! - med[0]!) + Math.abs(s[1]! - med[1]!) + Math.abs(s[2]! - med[2]!) < 45);
  if (keep.length < 20) return null;
  return [0, 1, 2].map((c) => keep.reduce((acc, s) => acc + s[c]!, 0) / keep.length) as [number, number, number];
}

/**
 * A patch's colours as if lit like `ref` (sRGB 0–255): each channel scaled by ref / table in linear
 * light (von Kries), where `table` is the table's colour around the piece in its photo. Evens out a
 * lamp's light falling unevenly across the table, and photos' different colour casts.
 */
export function evenLight(rgba: Uint8Array, table: ArrayLike<number>, ref: ArrayLike<number>): Uint8Array {
  const gain = [0, 1, 2].map((c) => toLinear(ref[c]!) / Math.max(1e-4, toLinear(table[c]!)));
  const out = new Uint8Array(rgba);
  for (let i = 0; i < out.length; i += 4) if (out[i + 3]) for (let c = 0; c < 3; c++) out[i + c] = toSrgb(toLinear(rgba[i + c]!) * gain[c]!);
  return out;
}
