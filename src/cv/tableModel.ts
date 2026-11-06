/**
 * What the empty table looks like, and the per-photo lighting field (RESEARCH §6 and its
 * "Update 2026-11-06": no mat, a white glossy table).
 *
 * - `shrinkRgb`: exact area-average shrink of an RGBA photo to a small RGB copy (plain JS, so the
 *   12 MP photo never has to be copied into OpenCV's WebAssembly memory).
 * - `estimateField`: the table colour at every point of one photo, as a coarse grid (one value per
 *   few mm) fitted on table pixels only: a robust mode of the brightness in a ~40 mm window around
 *   each cell (pieces, even pale ones, rarely cover most of such a window), then a median filter,
 *   hole filling and smoothing. It absorbs the lamp gradient, vignetting, the hand/phone shadow and
 *   white balance, so the piece finder compares every pixel with "the table right here".
 * - `learnTable`: the TableModel saved per project from one photo of the empty sorting area: Lab
 *   mean/covariance of table pixels (robust to stray marks: only pixels near the brightness mode
 *   and the colour mode count), a coarse brightness map in table mm (10 mm cells) and the share of
 *   the sorting area under glare.
 *
 * Everything here is plain TypeScript on typed arrays; only `learnTable` takes `cv` (unused today,
 * kept so all CV entry points look alike and can move work into OpenCV later).
 */
import type { Cv } from './loadCv';
import type { PixelBuffer } from './frameAnalyser';
import { applyH, invertH } from '../geo/homography';
import type { Mat3, MarkerMap, TableModel, Vec2 } from '../project/types';

// ---- Small RGB image ----------------------------------------------------------------------------

/** An interleaved 8-bit RGB image, `factor` times smaller than the photo it came from. */
export interface SmallRgb {
  width: number;
  height: number;
  /** width × height × 3, tightly packed. */
  rgb: Uint8Array;
  /** Photo px per small px (≥ 1, need not be an integer). Small pixel centre i ↔ photo (i + 0.5)·factor − 0.5. */
  factor: number;
  /** Darkest photo pixel (luma (R + 2G + B) / 4) under each small pixel: keeps thin dark lines (cut edges, contact shadows). */
  minY: Uint8Array;
}

/**
 * Area-average shrink by any factor ≥ 1 (exact box filter with fractional edge weights), one
 * output row at a time so memory stays at one row of floats.
 */
export function shrinkRgb(src: PixelBuffer, factor: number): SmallRgb {
  const f = Math.max(1, factor);
  const W = src.width;
  const H = src.height;
  const w = Math.max(1, Math.floor(W / f));
  const h = Math.max(1, Math.floor(H / f));
  const out = new Uint8Array(w * h * 3);
  // Column spans and weights.
  const cx0 = new Int32Array(w);
  const cx1 = new Int32Array(w);
  const cw0 = new Float32Array(w);
  const cw1 = new Float32Array(w);
  for (let j = 0; j < w; j++) {
    const a = j * f;
    const b = Math.min(W, (j + 1) * f);
    const i0 = Math.floor(a);
    const i1 = Math.min(W - 1, Math.ceil(b) - 1);
    cx0[j] = i0;
    cx1[j] = i1;
    cw0[j] = i0 === i1 ? b - a : i0 + 1 - a;
    cw1[j] = i0 === i1 ? 0 : b - i1;
  }
  const rowAcc = new Float32Array(w * 3);
  const tmp = new Float32Array(w * 3);
  const minY = new Uint8Array(w * h);
  const rowMin = new Float32Array(w);
  const data = src.data;
  const stride = src.stride;
  for (let i = 0; i < h; i++) {
    const a = i * f;
    const b = Math.min(H, (i + 1) * f);
    const r0 = Math.floor(a);
    const r1 = Math.min(H - 1, Math.ceil(b) - 1);
    rowAcc.fill(0);
    rowMin.fill(255);
    let wsum = 0;
    for (let r = r0; r <= r1; r++) {
      const wy = r0 === r1 ? b - a : r === r0 ? r0 + 1 - a : r === r1 ? b - r1 : 1;
      const base = r * stride;
      for (let j = 0; j < w; j++) {
        const i0 = cx0[j]!;
        const i1 = cx1[j]!;
        let p = base + i0 * 4;
        let sr = data[p]! * cw0[j]!;
        let sg = data[p + 1]! * cw0[j]!;
        let sb = data[p + 2]! * cw0[j]!;
        let mn = data[p]! + 2 * data[p + 1]! + data[p + 2]!;
        for (let x = i0 + 1; x < i1; x++) {
          p += 4;
          sr += data[p]!;
          sg += data[p + 1]!;
          sb += data[p + 2]!;
          const l = data[p]! + 2 * data[p + 1]! + data[p + 2]!;
          if (l < mn) mn = l;
        }
        if (i1 > i0) {
          const q = base + i1 * 4;
          const w1 = cw1[j]!;
          sr += data[q]! * w1;
          sg += data[q + 1]! * w1;
          sb += data[q + 2]! * w1;
          const l = data[q]! + 2 * data[q + 1]! + data[q + 2]!;
          if (l < mn) mn = l;
        }
        if (mn * 0.25 < rowMin[j]!) rowMin[j] = mn * 0.25;
        tmp[j * 3] = sr;
        tmp[j * 3 + 1] = sg;
        tmp[j * 3 + 2] = sb;
      }
      for (let k = 0; k < w * 3; k++) rowAcc[k]! += tmp[k]! * wy;
      wsum += wy;
    }
    const norm = 1 / (wsum * f);
    const o = i * w * 3;
    for (let k = 0; k < w * 3; k++) out[o + k] = Math.min(255, Math.round(rowAcc[k]! * norm));
    for (let j = 0; j < w; j++) minY[i * w + j] = Math.round(rowMin[j]!);
  }
  return { width: w, height: h, rgb: out, factor: f, minY };
}

// ---- Lighting field -----------------------------------------------------------------------------

/** The table's colour across one photo: a coarse grid of RGB values at cell centres. */
export interface LightField {
  /** Cell size in small-image px. */
  cell: number;
  gw: number;
  gh: number;
  /** gw × gh × 3 (R, G, B of the table at the cell centre). */
  rgb: Float32Array;
  /** Table chromaticity (r = R/(R+G+B), b = B/(R+G+B)). */
  chroma: [number, number];
  /** Robust relative noise of table brightness around the field (≈ σ of Y/field − 1). */
  noise: number;
  /** Share of cells that had enough table pixels (the rest were filled in). */
  coverage: number;
  /** The table itself is blown out (≥ 30 % of table pixels clipped): glare can't be seen. */
  clipped: boolean;
}

export interface FieldOptions {
  /** Small px per mm (to size cells and windows in mm). */
  pxPerMm: number;
  /** Pixels to ignore (marker cards, outside the image): 1 = ignore. */
  ignore?: Uint8Array | null;
  /** Expected table chromaticity (from a TableModel), used to pick the right colour mode. */
  chromaPrior?: [number, number] | null;
}

const CELL_MM = 8;
const WINDOW_MM = 40;

const luma = (r: number, g: number, b: number) => (r + 2 * g + b) * 0.25;

export function estimateField(img: SmallRgb, opts: FieldOptions): LightField {
  const { width: w, height: h, rgb } = img;
  const ignore = opts.ignore ?? null;
  const cell = Math.max(4, Math.round(CELL_MM * opts.pxPerMm));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);

  // 1. Table chromaticity: mode of a 2D histogram of (r, b) over bright-ish pixels.
  const CB = 100;
  const C0 = 0.2;
  const CS = 0.003; // bin width
  const chist = new Uint32Array(CB * CB);
  for (let p = 0, k = 0; p < w * h; p++, k += 3) {
    if (ignore && ignore[p]) continue;
    const R = rgb[k]!;
    const G = rgb[k + 1]!;
    const B = rgb[k + 2]!;
    const Y = luma(R, G, B);
    if (Y < 60 || Y > 252) continue;
    const s = R + G + B;
    const ri = Math.floor((R / s - C0) / CS);
    const bi = Math.floor((B / s - C0) / CS);
    if (ri < 0 || bi < 0 || ri >= CB || bi >= CB) continue;
    chist[ri * CB + bi]!++;
  }
  let best = -1;
  let bestN = -1;
  for (let ri = 1; ri < CB - 1; ri++)
    for (let bi = 1; bi < CB - 1; bi++) {
      let n = 0;
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) n += chist[(ri + a) * CB + bi + c]!;
      if (opts.chromaPrior) {
        const dr = C0 + (ri + 0.5) * CS - opts.chromaPrior[0];
        const db = C0 + (bi + 0.5) * CS - opts.chromaPrior[1];
        n *= Math.exp(-(dr * dr + db * db) / (2 * 0.02 * 0.02));
      }
      if (n > bestN) {
        bestN = n;
        best = ri * CB + bi;
      }
    }
  const chroma: [number, number] = best < 0 ? [1 / 3, 1 / 3] : [C0 + (Math.floor(best / CB) + 0.5) * CS, C0 + ((best % CB) + 0.5) * CS];
  const TOL = 0.014;

  // Is the table itself blown out (over-exposed photo)? Then clipped pixels are table, not glare.
  let nTab = 0;
  let nClip = 0;
  for (let p = 0, k = 0; p < w * h; p++, k += 3) {
    if (ignore && ignore[p]) continue;
    const R = rgb[k]!;
    const G = rgb[k + 1]!;
    const B = rgb[k + 2]!;
    const s = R + G + B;
    if (s < 30) continue;
    if (Math.abs(R / s - chroma[0]) > 0.014 || Math.abs(B / s - chroma[1]) > 0.014) continue;
    nTab++;
    if (luma(R, G, B) > 251) nClip++;
  }
  const clippedTable = nClip > 0.3 * nTab;

  // 2. Per-cell brightness histograms of table-coloured pixels (64 bins of 4 levels).
  const NB = 64;
  const hist = new Uint32Array(gw * gh * NB);
  const total = new Uint32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / cell);
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (ignore && ignore[p]) continue;
      const g = gy * gw + Math.floor(x / cell);
      total[g]!++;
      const k = p * 3;
      const R = rgb[k]!;
      const G = rgb[k + 1]!;
      const B = rgb[k + 2]!;
      const s = R + G + B;
      if (s < 30) continue;
      const Y = luma(R, G, B);
      if (Y > 251 && !clippedTable) continue; // clipped (glare core): not a usable table sample
      if (Math.abs(R / s - chroma[0]) > TOL || Math.abs(B / s - chroma[1]) > TOL) continue;
      hist[g * NB + Math.min(NB - 1, Math.floor(Y / 4))]!++;
    }
  }

  // 3. Mode of the window histogram around each cell.
  const rad = Math.max(1, Math.round(WINDOW_MM / CELL_MM / 2));
  const mode = new Float32Array(gw * gh).fill(-1);
  const win = new Float32Array(NB);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      win.fill(0);
      let tot = 0;
      for (let j = Math.max(0, gy - rad); j <= Math.min(gh - 1, gy + rad); j++)
        for (let i = Math.max(0, gx - rad); i <= Math.min(gw - 1, gx + rad); i++) {
          const g = j * gw + i;
          // Nearer cells count more (keeps the mode local where lighting changes fast).
          const wgt = 1 / (1 + Math.max(Math.abs(j - gy), Math.abs(i - gx)));
          tot += total[g]! * wgt;
          const o = g * NB;
          for (let b = 0; b < NB; b++) win[b]! += hist[o + b]! * wgt;
        }
      let bi = -1;
      let bn = 0;
      for (let b = 1; b < NB; b++) {
        const n = win[b - 1]! * 0.5 + win[b]! + (b + 1 < NB ? win[b + 1]! : 0) * 0.5;
        if (n > bn) {
          bn = n;
          bi = b;
        }
      }
      if (bi < 0 || bn < 0.1 * tot) continue;
      // Sub-bin peak (parabola).
      const a0 = win[bi - 1]!;
      const a1 = win[bi]!;
      const a2 = bi + 1 < NB ? win[bi + 1]! : 0;
      const den = a0 - 2 * a1 + a2;
      const off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a0 - a2)) / den)) : 0;
      mode[gy * gw + gx] = (bi + 0.5 + off) * 4;
    }

  // 4. Mean RGB of the cell's own table pixels near the mode (falls back to the window mode).
  const sums = new Float64Array(gw * gh * 4);
  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / cell);
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (ignore && ignore[p]) continue;
      const g = gy * gw + Math.floor(x / cell);
      const m = mode[g]!;
      if (m < 0) continue;
      const k = p * 3;
      const R = rgb[k]!;
      const G = rgb[k + 1]!;
      const B = rgb[k + 2]!;
      const s = R + G + B;
      if (s < 30) continue;
      const Y = luma(R, G, B);
      if (Math.abs(Y - m) > 0.05 * m + 3) continue;
      if (Math.abs(R / s - chroma[0]) > TOL || Math.abs(B / s - chroma[1]) > TOL) continue;
      sums[g * 4]! += R;
      sums[g * 4 + 1]! += G;
      sums[g * 4 + 2]! += B;
      sums[g * 4 + 3]!++;
    }
  }
  const field = new Float32Array(gw * gh * 3);
  const ok = new Uint8Array(gw * gh);
  const minN = Math.max(6, 0.12 * cell * cell);
  let nOk = 0;
  for (let g = 0; g < gw * gh; g++) {
    const n = sums[g * 4 + 3]!;
    if (n >= minN) {
      field[g * 3] = sums[g * 4]! / n;
      field[g * 3 + 1] = sums[g * 4 + 1]! / n;
      field[g * 3 + 2] = sums[g * 4 + 2]! / n;
      ok[g] = 1;
      nOk++;
    } else if (mode[g]! > 0) {
      // Few own table pixels (a piece covers the cell): the window mode, in the table's colour.
      const m = mode[g]!;
      const s = (4 * m) / (chroma[0] + 2 * (1 - chroma[0] - chroma[1]) + chroma[1]);
      field[g * 3] = chroma[0] * s;
      field[g * 3 + 1] = (1 - chroma[0] - chroma[1]) * s;
      field[g * 3 + 2] = chroma[1] * s;
      ok[g] = 2;
    }
  }

  // 5. Robust clean-up: 3 × 3 median of brightness (removes cells fooled by a pale piece), fill
  //    empty cells from their neighbours, then a light smoothing.
  medianClean(field, ok, gw, gh);
  fillHolesGrid(field, ok, gw, gh);
  smoothGrid(field, gw, gh);

  const lf: LightField = { cell, gw, gh, rgb: field, chroma, noise: 0.01, coverage: nOk / Math.max(1, gw * gh), clipped: clippedTable };
  lf.noise = fieldNoise(img, lf, ignore);
  return lf;
}

function medianClean(field: Float32Array, ok: Uint8Array, gw: number, gh: number): void {
  const Y = new Float32Array(gw * gh);
  for (let g = 0; g < gw * gh; g++) Y[g] = ok[g] ? luma(field[g * 3]!, field[g * 3 + 1]!, field[g * 3 + 2]!) : -1;
  const vals: number[] = [];
  const out = new Float32Array(field);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      const g = gy * gw + gx;
      if (!ok[g]) continue;
      vals.length = 0;
      for (let j = Math.max(0, gy - 1); j <= Math.min(gh - 1, gy + 1); j++)
        for (let i = Math.max(0, gx - 1); i <= Math.min(gw - 1, gx + 1); i++) if (Y[j * gw + i]! > 0) vals.push(Y[j * gw + i]!);
      if (vals.length < 3) continue;
      vals.sort((a, b) => a - b);
      const med = vals[vals.length >> 1]!;
      // A cell clearly darker than its neighbourhood was probably fooled by a piece.
      if (Y[g]! < med * 0.965) {
        const k = med / Y[g]!;
        out[g * 3] = field[g * 3]! * k;
        out[g * 3 + 1] = field[g * 3 + 1]! * k;
        out[g * 3 + 2] = field[g * 3 + 2]! * k;
      }
    }
  field.set(out);
}

function fillHolesGrid(field: Float32Array, ok: Uint8Array, gw: number, gh: number): void {
  const known = new Uint8Array(gw * gh);
  let any = false;
  for (let g = 0; g < gw * gh; g++) {
    known[g] = ok[g] ? 1 : 0;
    any ||= known[g] === 1;
  }
  if (!any) {
    for (let g = 0; g < gw * gh * 3; g++) field[g] = 200;
    return;
  }
  for (let iter = 0; iter < gw + gh; iter++) {
    let changed = false;
    const add: Array<[number, number, number, number]> = [];
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const g = gy * gw + gx;
        if (known[g]) continue;
        let r = 0;
        let gg = 0;
        let b = 0;
        let n = 0;
        for (let j = Math.max(0, gy - 1); j <= Math.min(gh - 1, gy + 1); j++)
          for (let i = Math.max(0, gx - 1); i <= Math.min(gw - 1, gx + 1); i++) {
            const q = j * gw + i;
            if (!known[q]) continue;
            r += field[q * 3]!;
            gg += field[q * 3 + 1]!;
            b += field[q * 3 + 2]!;
            n++;
          }
        if (n) add.push([g, r / n, gg / n, b / n]);
      }
    for (const [g, r, gg, b] of add) {
      field[g * 3] = r;
      field[g * 3 + 1] = gg;
      field[g * 3 + 2] = b;
      known[g] = 1;
      changed = true;
    }
    if (!changed) break;
  }
}

function smoothGrid(field: Float32Array, gw: number, gh: number): void {
  const k = [0.25, 0.5, 0.25];
  const tmp = new Float32Array(field.length);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let ws = 0;
        for (let d = -1; d <= 1; d++) {
          const i = gx + d;
          if (i < 0 || i >= gw) continue;
          s += field[(gy * gw + i) * 3 + c]! * k[d + 1]!;
          ws += k[d + 1]!;
        }
        tmp[(gy * gw + gx) * 3 + c] = s / ws;
      }
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let ws = 0;
        for (let d = -1; d <= 1; d++) {
          const j = gy + d;
          if (j < 0 || j >= gh) continue;
          s += tmp[(j * gw + gx) * 3 + c]! * k[d + 1]!;
          ws += k[d + 1]!;
        }
        field[(gy * gw + gx) * 3 + c] = s / ws;
      }
}

/**
 * Fills `out` (width × 3) with the field's RGB along small-image row y (bilinear between cell
 * centres), for columns x0 ≤ x < width (default all).
 */
export function fieldRow(lf: LightField, y: number, width: number, out: Float32Array, x0 = 0): void {
  const { cell, gw, gh, rgb } = lf;
  const gyf = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
  const j0 = Math.min(gh - 2, Math.floor(gyf));
  const fy = gh === 1 ? 0 : gyf - Math.max(0, j0);
  const ja = Math.max(0, j0);
  const jb = Math.min(gh - 1, ja + 1);
  for (let x = x0; x < width; x++) {
    const gxf = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
    const i0 = Math.min(Math.max(0, gw - 2), Math.floor(gxf));
    const i1 = Math.min(gw - 1, i0 + 1);
    const fx = gxf - i0;
    const a = (ja * gw + i0) * 3;
    const b = (ja * gw + i1) * 3;
    const c = (jb * gw + i0) * 3;
    const d = (jb * gw + i1) * 3;
    for (let ch = 0; ch < 3; ch++) {
      const top = rgb[a + ch]! + (rgb[b + ch]! - rgb[a + ch]!) * fx;
      const bot = rgb[c + ch]! + (rgb[d + ch]! - rgb[c + ch]!) * fx;
      out[x * 3 + ch] = top + (bot - top) * fy;
    }
  }
}

/** The field's RGB at one small-image point. */
export function fieldAt(lf: LightField, x: number, y: number): [number, number, number] {
  const { cell, gw, gh, rgb } = lf;
  const gxf = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
  const gyf = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
  const i0 = Math.min(Math.max(0, gw - 2), Math.floor(gxf));
  const j0 = Math.min(Math.max(0, gh - 2), Math.floor(gyf));
  const i1 = Math.min(gw - 1, i0 + 1);
  const j1 = Math.min(gh - 1, j0 + 1);
  const fx = gxf - i0;
  const fy = gyf - j0;
  const o: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const top = rgb[(j0 * gw + i0) * 3 + ch]! + (rgb[(j0 * gw + i1) * 3 + ch]! - rgb[(j0 * gw + i0) * 3 + ch]!) * fx;
    const bot = rgb[(j1 * gw + i0) * 3 + ch]! + (rgb[(j1 * gw + i1) * 3 + ch]! - rgb[(j1 * gw + i0) * 3 + ch]!) * fx;
    o[ch] = top + (bot - top) * fy;
  }
  return o;
}

/** Robust σ of Y/field − 1 over pixels that look like table (MAD × 1.48). */
function fieldNoise(img: SmallRgb, lf: LightField, ignore: Uint8Array | null): number {
  const { width: w, height: h, rgb } = img;
  const row = new Float32Array(w * 3);
  const hist = new Uint32Array(400);
  let n = 0;
  const step = Math.max(1, Math.floor(h / 200));
  for (let y = 0; y < h; y += step) {
    fieldRow(lf, y, w, row);
    for (let x = 0; x < w; x += 2) {
      const p = y * w + x;
      if (ignore && ignore[p]) continue;
      const k = p * 3;
      const Y = luma(rgb[k]!, rgb[k + 1]!, rgb[k + 2]!);
      const E = luma(row[x * 3]!, row[x * 3 + 1]!, row[x * 3 + 2]!);
      if (E < 20) continue;
      const d = Math.abs(Y / E - 1);
      if (d >= 0.1) continue;
      hist[Math.floor(d * 4000)]!++;
      n++;
    }
  }
  if (n < 100) return 0.01;
  // Pieces and shadows sit in the tail; the table is the bulk near 0. Use the 40th percentile of
  // |dev| as a robust scale (for a normal distribution it is 0.52 σ).
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i]!;
    if (acc >= 0.4 * n) return Math.max(0.003, (i + 0.5) / 4000 / 0.52);
  }
  return 0.01;
}

// ---- Colour ---------------------------------------------------------------------------------------

const SRGB_LIN = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

function srgbToLin(v: number): number {
  const c = Math.min(1, Math.max(0, v / 255));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB (0–255, may be fractional) → CIE Lab (D65), L 0–100. */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = Number.isInteger(r) && r >= 0 && r < 256 ? SRGB_LIN[r]! : srgbToLin(r);
  const G = Number.isInteger(g) && g >= 0 && g < 256 ? SRGB_LIN[g]! : srgbToLin(g);
  const B = Number.isInteger(b) && b >= 0 && b < 256 ? SRGB_LIN[b]! : srgbToLin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference. */
export function deltaE(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

// ---- Marker cards -------------------------------------------------------------------------------

/** Card side (mm) for a marker map: the printed 90 mm card at the map's print scale. */
const CARD_MM = 90;
const MARKER_MM = 54;

/** Marker card outlines in table mm (square around each marker, with `marginMm` extra on every side). */
export function cardPolygonsMm(map: MarkerMap, marginMm: number): Vec2[][] {
  return map.markers.map((m) => {
    const c = m.cornersMm;
    const cx = (c[0]![0] + c[1]![0] + c[2]![0] + c[3]![0]) / 4;
    const cy = (c[0]![1] + c[1]![1] + c[2]![1] + c[3]![1]) / 4;
    const side = Math.hypot(c[1]![0] - c[0]![0], c[1]![1] - c[0]![1]) || map.markerSizeMm;
    const k = (side * (CARD_MM / MARKER_MM) / 2 + marginMm) / (side / 2);
    return c.map((p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k] as Vec2);
  });
}

/** Rasterises polygons (small-image px) into `mask` (value 1), scanline even–odd fill. */
export function fillPolygons(mask: Uint8Array, w: number, h: number, polys: Vec2[][]): void {
  for (const poly of polys) {
    const n = poly.length;
    if (n < 3) continue;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of poly) {
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
    const ya = Math.max(0, Math.ceil(y0));
    const yb = Math.min(h - 1, Math.floor(y1));
    const xs: number[] = [];
    for (let y = ya; y <= yb; y++) {
      const yc = y; // pixel centres at integers (OpenCV convention)
      xs.length = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = poly[i]!;
        const [xj, yj] = poly[j]!;
        if (yi > yc !== yj > yc) xs.push(xi + ((yc - yi) * (xj - xi)) / (yj - yi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k]!));
        const xb = Math.min(w - 1, Math.floor(xs[k + 1]!));
        for (let x = xa; x <= xb; x++) mask[y * w + x] = 1;
      }
    }
  }
}

/** Table mm polygon → small-image px polygon. */
export function tableToSmall(poly: Vec2[], tableToImg: Mat3, factor: number): Vec2[] {
  return poly.map((p) => {
    const q = applyH(tableToImg, p);
    return [(q[0] + 0.5) / factor - 0.5, (q[1] + 0.5) / factor - 0.5] as Vec2;
  });
}

/** Sorting area (convex hull of the marker centres, table mm), shrunk by `insetMm`. */
export function sortingAreaMm(map: MarkerMap, insetMm = 0): Vec2[] {
  const pts: Vec2[] = map.markers.map((m) => {
    const c = m.cornersMm;
    return [(c[0]![0] + c[1]![0] + c[2]![0] + c[3]![0]) / 4, (c[0]![1] + c[1]![1] + c[2]![1] + c[3]![1]) / 4];
  });
  const hull = convexHull(pts);
  if (!insetMm || hull.length < 3) return hull;
  let cx = 0;
  let cy = 0;
  for (const p of hull) {
    cx += p[0];
    cy += p[1];
  }
  cx /= hull.length;
  cy /= hull.length;
  return hull.map((p) => {
    const d = Math.hypot(p[0] - cx, p[1] - cy) || 1;
    const k = Math.max(0, (d - insetMm) / d);
    return [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k] as Vec2;
  });
}

function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// ---- Learning the empty table -------------------------------------------------------------------

/** Small px per mm used for table learning and piece detection (plenty to find a ~18 mm piece). */
export const DETECT_PX_PER_MM = 3;
/** Brightness map cell (mm). */
export const TABLE_MAP_CELL_MM = 10;
/** A table pixel counts as glare when it is this much brighter than the field, or clipped. */
export const GLARE_GAIN = 1.1;

/** Local px per mm of an image → table homography at image point p (geometric mean of both axes). */
export function pxPerMmAt(tableToImg: Mat3, imgToTable: Mat3, p: Vec2): number {
  const t = applyH(imgToTable, p);
  const a = applyH(tableToImg, t);
  const bx = applyH(tableToImg, [t[0] + 1, t[1]]);
  const by = applyH(tableToImg, [t[0], t[1] + 1]);
  return Math.sqrt(Math.abs((bx[0] - a[0]) * (by[1] - a[1]) - (bx[1] - a[1]) * (by[0] - a[0])));
}

/**
 * Learns the TableModel from a photo of the empty sorting area (RESEARCH §6). `imgToTable` maps
 * photo px → table mm (from the markers). Stray marks, the marker cards and glare don't count.
 */
export function learnTable(cv: Cv, rgba: PixelBuffer, opts: { imgToTable: Mat3; map: MarkerMap; snapId: string }): TableModel {
  void cv;
  const tableToImg = invertH(opts.imgToTable);
  if (!tableToImg) throw new Error('learnTable: the photo → table mapping cannot be inverted');
  const W = rgba.width;
  const H = rgba.height;
  const ppm = pxPerMmAt(tableToImg, opts.imgToTable, [(W - 1) / 2, (H - 1) / 2]);
  const img = shrinkRgb(rgba, Math.max(1, ppm / DETECT_PX_PER_MM));
  const { width: w, height: h, rgb, factor } = img;
  const sppm = ppm / factor;

  const ignore = new Uint8Array(w * h);
  fillPolygons(ignore, w, h, cardPolygonsMm(opts.map, 4).map((p) => tableToSmall(p, tableToImg, factor)));
  const field = estimateField(img, { pxPerMm: sppm, ignore });

  // Table pixels: close to the field in brightness and colour, not clipped.
  const area = new Uint8Array(w * h);
  fillPolygons(area, w, h, [tableToSmall(sortingAreaMm(opts.map), tableToImg, factor)]);
  const row = new Float32Array(w * 3);
  let n = 0;
  const sum = [0, 0, 0];
  const sq = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let areaN = 0;
  let glareN = 0;
  const labs: Array<[number, number, number]> = [];
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 200000)));
  for (let y = 0; y < h; y += 1) {
    fieldRow(field, y, w, row);
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (ignore[p]) continue;
      const k = p * 3;
      const R = rgb[k]!;
      const G = rgb[k + 1]!;
      const B = rgb[k + 2]!;
      const Y = luma(R, G, B);
      const E = luma(row[x * 3]!, row[x * 3 + 1]!, row[x * 3 + 2]!);
      const isGlare = Y > E * GLARE_GAIN || (Y >= 250 && E < 240);
      if (area[p]) {
        areaN++;
        if (isGlare) glareN++;
      }
      if (isGlare || Math.abs(Y / E - 1) > Math.max(0.04, 4 * field.noise)) continue;
      if ((x + y) % step !== 0) continue;
      labs.push(rgbToLab(R, G, B));
    }
  }
  for (const l of labs) {
    for (let i = 0; i < 3; i++) sum[i]! += l[i]!;
    n++;
  }
  const mean: [number, number, number] = n ? [sum[0]! / n, sum[1]! / n, sum[2]! / n] : [90, 0, 0];
  for (const l of labs) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) sq[i * 3 + j]! += (l[i]! - mean[i]!) * (l[j]! - mean[j]!);
  const cov = sq.map((v) => (n > 1 ? v / (n - 1) : 0));

  // Coarse brightness map (Lab L of the fitted field) in table mm over what the photo shows.
  const corners: Vec2[] = [
    [-0.5, -0.5],
    [W - 0.5, -0.5],
    [W - 0.5, H - 0.5],
    [-0.5, H - 0.5],
  ].map((p) => applyH(opts.imgToTable, p as Vec2));
  const x0 = Math.floor(Math.min(...corners.map((c) => c[0])) / TABLE_MAP_CELL_MM) * TABLE_MAP_CELL_MM;
  const y0 = Math.floor(Math.min(...corners.map((c) => c[1])) / TABLE_MAP_CELL_MM) * TABLE_MAP_CELL_MM;
  const x1 = Math.max(...corners.map((c) => c[0]));
  const y1 = Math.max(...corners.map((c) => c[1]));
  const cols = Math.max(1, Math.min(400, Math.ceil((x1 - x0) / TABLE_MAP_CELL_MM)));
  const rows = Math.max(1, Math.min(400, Math.ceil((y1 - y0) / TABLE_MAP_CELL_MM)));
  const L: number[] = new Array(cols * rows).fill(-1);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const q = applyH(tableToImg, [x0 + (i + 0.5) * TABLE_MAP_CELL_MM, y0 + (j + 0.5) * TABLE_MAP_CELL_MM]);
      const sx = (q[0] + 0.5) / factor - 0.5;
      const sy = (q[1] + 0.5) / factor - 0.5;
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) continue;
      const c = fieldAt(field, sx, sy);
      L[j * cols + i] = Math.round(rgbToLab(c[0], c[1], c[2])[0] * 10) / 10;
    }

  return {
    meanLab: mean,
    covLab: cov,
    map: { originMm: [x0, y0], cellMm: TABLE_MAP_CELL_MM, cols, rows, L },
    glareShare: areaN ? glareN / areaN : 0,
    snapId: opts.snapId,
    createdAt: Date.now(),
  };
}

/** Table chromaticity (r, b) expected from a TableModel's mean Lab (for the field's colour prior). */
export function tableChroma(model: TableModel): [number, number] {
  const [L, a, b] = model.meanLab;
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047;
  const Y = inv(fy);
  const Z = inv(fz) * 1.08883;
  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const G = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  const enc = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055);
  const r = enc(R);
  const g = enc(G);
  const bb = enc(B);
  const s = r + g + bb || 1;
  return [r / s, bb / s];
}
