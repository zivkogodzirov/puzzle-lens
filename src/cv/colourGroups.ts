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
   * piece's lightness across its face far more than its hue.
   */
  lWeight: 0.6,
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
