/**
 * A piece's fingerprint for re-identification (M5 part 3, RESEARCH §8): its printed picture, from
 * the straightened patch made for box placement (src/cv/placement.ts extractPatch), reduced to a
 * GRID × GRID grid of colours over the piece's core square. Brightness is taken relative to the
 * piece's own average (a lamp moved, the exposure changed), and each cell uses medians so a glare
 * spot or a shadow edge moves it little.
 *
 * The patch's orientation depends on which corner shape reading called the first, so two sightings
 * are compared in all four quarter turns; their side shapes (knob out / in / flat), when both are
 * read, must agree in the turn used.
 */
import { PATCH_CORE, PATCH_MARGIN, type PiecePatch } from './placement';
import { rgbToLab } from './tableModel';

/** Cells across the core square. */
export const FP_GRID = 4;
/** Numbers per cell: L (relative), a, b. */
const PER = 3;
/** A side read the other way round (knob out vs in) in the turn compared adds this (ΔE units). */
export const FP_SIDE_PENALTY = 6;
/** The print's brightness pattern: TEX × TEX cells over the core, contrast-normalised (z-scores). */
export const FP_TEX = 8;
/** Weight of the brightness pattern's RMS difference (z units) against the colour grid's ΔE. */
export let FP_TEX_WEIGHT = 6;
/** For experiments. */
export function setTexWeight(w: number): void {
  FP_TEX_WEIGHT = w;
}

/** The fingerprint: FP_GRID² cells × [L − mean L, a, b], cells row by row from the patch's top-left. */
export function pieceFingerprint(patch: PiecePatch, grid = FP_GRID, inset = 0): number[] | null {
  const FP_GRID_ = grid;
  const S = patch.size;
  const span = PATCH_CORE + 2 * inset;
  const cell = span / FP_GRID_;
  const x0 = PATCH_MARGIN - inset;
  const out: number[] = [];
  const Ls: number[] = [];
  const cells: Array<[number, number, number] | null> = [];
  for (let gy = 0; gy < FP_GRID_; gy++)
    for (let gx = 0; gx < FP_GRID_; gx++) {
      const L: number[] = [];
      const A: number[] = [];
      const B: number[] = [];
      for (let y = Math.round(x0 + gy * cell); y < Math.round(x0 + (gy + 1) * cell); y++)
        for (let x = Math.round(x0 + gx * cell); x < Math.round(x0 + (gx + 1) * cell); x++) {
          const k = (y * S + x) * 4;
          if (patch.rgba[k + 3]! < 128) continue;
          const lab = rgbToLab(patch.rgba[k]!, patch.rgba[k + 1]!, patch.rgba[k + 2]!);
          L.push(lab[0]);
          A.push(lab[1]);
          B.push(lab[2]);
        }
      if (L.length < (cell * cell) / 4) {
        cells.push(null);
        continue;
      }
      const m = [median(L), median(A), median(B)] as [number, number, number];
      cells.push(m);
      Ls.push(m[0]);
    }
  if (Ls.length < (FP_GRID_ * FP_GRID_) / 2) return null;
  const meanL = Ls.reduce((s, v) => s + v, 0) / Ls.length;
  for (const c of cells) {
    if (!c) out.push(NaN, NaN, NaN);
    else out.push(round1(c[0] - meanL), round1(c[1]), round1(c[2]));
  }
  // The brightness pattern (finer, contrast-normalised): catches print detail the colour means miss.
  const tc = PATCH_CORE / FP_TEX;
  const tex: number[] = [];
  for (let gy = 0; gy < FP_TEX; gy++)
    for (let gx = 0; gx < FP_TEX; gx++) {
      let sum = 0;
      let n = 0;
      for (let y = Math.round(PATCH_MARGIN + gy * tc); y < Math.round(PATCH_MARGIN + (gy + 1) * tc); y++)
        for (let x = Math.round(PATCH_MARGIN + gx * tc); x < Math.round(PATCH_MARGIN + (gx + 1) * tc); x++) {
          const k = (y * S + x) * 4;
          if (patch.rgba[k + 3]! < 128) continue;
          sum += 0.299 * patch.rgba[k]! + 0.587 * patch.rgba[k + 1]! + 0.114 * patch.rgba[k + 2]!;
          n++;
        }
      tex.push(n >= (tc * tc) / 3 ? sum / n : NaN);
    }
  const ok = tex.filter((v) => !Number.isNaN(v));
  const m = ok.reduce((a, b) => a + b, 0) / Math.max(1, ok.length);
  const sd = Math.sqrt(ok.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, ok.length)) || 1;
  for (const v of tex) out.push(Number.isNaN(v) ? NaN : round1((v - m) / Math.max(sd, 4)));
  return out;
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Cell index after turning a g × g grid q quarter turns clockwise. */
function turned(i: number, q: number, g: number): number {
  let x = i % g;
  let y = Math.floor(i / g);
  for (let k = 0; k < q; k++) [x, y] = [g - 1 - y, x];
  return y * g + x;
}

/**
 * How different two fingerprints are (mean colour difference per cell, ΔE-like), at the best
 * quarter turn of `b` against `a` (`rot`: turns of b), with side shapes counted when given.
 */
export function fingerprintDistance(a: number[], b: number[], sidesA?: string | null, sidesB?: string | null): { d: number; rot: number } {
  let best = Infinity;
  let rot = 0;
  const nCol = FP_GRID * FP_GRID;
  const n = Math.min(a.length, b.length) >= nCol * PER ? nCol : Math.min(a.length, b.length) / PER;
  const g = Math.round(Math.sqrt(n));
  const hasTex = a.length >= nCol * PER + FP_TEX * FP_TEX && b.length >= nCol * PER + FP_TEX * FP_TEX;
  for (let q = 0; q < 4; q++) {
    let sum = 0;
    let used = 0;
    for (let i = 0; i < n; i++) {
      const j = turned(i, q, g);
      const ai = i * PER;
      const bj = j * PER;
      if (Number.isNaN(a[ai]!) || Number.isNaN(b[bj]!)) continue;
      sum += Math.hypot(a[ai]! - b[bj]!, a[ai + 1]! - b[bj + 1]!, a[ai + 2]! - b[bj + 2]!);
      used++;
    }
    if (used < n / 2) continue;
    let d = sum / used;
    if (hasTex && FP_TEX_WEIGHT > 0) {
      let s2 = 0;
      let u2 = 0;
      const o = nCol * PER;
      for (let i = 0; i < FP_TEX * FP_TEX; i++) {
        const j = turned(i, q, FP_TEX);
        const va = a[o + i]!;
        const vb = b[o + j]!;
        if (Number.isNaN(va) || Number.isNaN(vb)) continue;
        s2 += (va - vb) ** 2;
        u2++;
      }
      if (u2 >= (FP_TEX * FP_TEX) / 2) d += FP_TEX_WEIGHT * Math.sqrt(s2 / u2);
    }
    if (sidesA && sidesB && sidesA.length === 4 && sidesB.length === 4)
      for (let e = 0; e < 4; e++) {
        // Side e of a's patch is side (e − q) of b's patch turned q times clockwise.
        const sa = sidesA[e]!;
        const sb = sidesB[(e - q + 4) % 4]!;
        if ((sa === 't' || sa === 'b' || sa === 'f') && (sb === 't' || sb === 'b' || sb === 'f') && sa !== sb) d += FP_SIDE_PENALTY;
      }
    if (d < best) {
      best = d;
      rot = q;
    }
  }
  return { d: best, rot };
}
