/**
 * A coin next to the pieces gives the photo's true scale (decision 2026-11-07): without printed
 * markers, sizes are otherwise estimated from a typical piece (18.6 mm). The owner picks which coin
 * it is; its diameter is known.
 *
 * Finding it: on the bright table, the coin is a dark-or-coloured blob that is round (circularity
 * ≥ 0.85, ellipse ≥ 0.85 round, solid) and coin-sized at the photo's estimated scale. Puzzle pieces
 * are far from round (circularity ≈ 0.4–0.65). The diameter is then measured on the full-size
 * pixels around it, at the half-way brightness between coin and table.
 */
import type { Cv } from './loadCv';
import type { PixelBuffer } from './frameAnalyser';
import { cvGuard } from './loadCv';
import { withScope } from './scope';

export interface CoinType {
  id: string;
  /** Label for the owner. */
  label: string;
  diameterMm: number;
  /** Where the size comes from (honesty: some are catalogue values, not the National Bank's). */
  source: 'NBRM' | 'catalogue';
}

/**
 * Macedonian denar coins in circulation. 1 and 5 denars: National Bank of the Republic of North
 * Macedonia decisions; 2, 10 and 50 denars: coin catalogues (not yet confirmed from the Bank).
 */
export const MK_COINS: readonly CoinType[] = [
  { id: 'mk-1', label: '1 denar', diameterMm: 23.8, source: 'NBRM' },
  { id: 'mk-2', label: '2 denari', diameterMm: 23.5, source: 'catalogue' },
  { id: 'mk-5', label: '5 denari', diameterMm: 27.5, source: 'NBRM' },
  { id: 'mk-10', label: '10 denari', diameterMm: 24.5, source: 'catalogue' },
  { id: 'mk-50', label: '50 denari', diameterMm: 26.5, source: 'catalogue' },
];

/** Chromaticity distance from the table that marks a coloured (brass) coin pixel. */
const COIN_CHROMA = 0.035;
/** Weight of a chromaticity step against an 8-bit brightness step when finding the rim. */
const COIN_CHROMA_GAIN = 500;

export function coinById(id: string | null | undefined): CoinType | null {
  return MK_COINS.find((c) => c.id === id) ?? null;
}

export interface CoinFound {
  /** Centre in photo px. */
  centre: [number, number];
  /** Measured diameter in photo px (full size). */
  diameterPx: number;
  circularity: number;
  roundness: number;
}

/**
 * Looks for one coin. `pxPerMm` is the photo's estimated scale (may be ~25 % off); coins of
 * 15–40 mm at that scale are considered. Returns the roundest candidate, or null.
 */
export function findCoin(cv: Cv, rgba: PixelBuffer, opts: { pxPerMm: number }): CoinFound | null {
  return cvGuard(cv, () =>
    withScope((s) => {
      const W = rgba.width;
      const H = rgba.height;
      // 1. Detection on a copy about 1200 px wide.
      const k = Math.max(1, Math.round(W / 1200));
      const w = Math.floor(W / k);
      const h = Math.floor(H / k);
      const gray = new Uint8Array(w * h);
      // Chromaticity (r = R/sum, b = B/sum) too: a shiny brass coin can be as bright as a cream
      // table and is found by its yellow colour instead (owner's photo 2026-11-07).
      const cr = new Float32Array(w * h);
      const cb = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0;
          let sr = 0;
          let sg = 0;
          let sb = 0;
          for (let dy = 0; dy < k; dy++) {
            const row = (y * k + dy) * rgba.stride;
            for (let dx = 0; dx < k; dx++) {
              const i = row + (x * k + dx) * 4;
              sr += rgba.data[i]!;
              sg += rgba.data[i + 1]!;
              sb += rgba.data[i + 2]!;
              sum += 0.299 * rgba.data[i]! + 0.587 * rgba.data[i + 1]! + 0.114 * rgba.data[i + 2]!;
            }
          }
          const p = y * w + x;
          gray[p] = Math.round(sum / (k * k));
          const t = Math.max(1, sr + sg + sb);
          cr[p] = sr / t;
          cb[p] = sb / t;
        }
      }
      const hist = new Uint32Array(256);
      for (const v of gray) hist[v]!++;
      let table = 200;
      for (let v = 255, best = -1; v >= 64; v--) if (hist[v]! > best) [best, table] = [hist[v]!, v];
      // The table's chromaticity: median over pixels at the table's brightness.
      const tr: number[] = [];
      const tb: number[] = [];
      for (let p = 0; p < gray.length; p += 7) {
        if (Math.abs(gray[p]! - table) > 6) continue;
        tr.push(cr[p]!);
        tb.push(cb[p]!);
      }
      const medOf = (v: number[]) => (v.length ? v.sort((a, b) => a - b)[v.length >> 1]! : 1 / 3);
      const tR = medOf(tr);
      const tB = medOf(tb);
      const thr = Math.max(14, 0.1 * table);
      const darkOrBright = (i: number) => Math.abs(gray[i]! - table) > thr;
      const coloured = (i: number) => Math.hypot(cr[i]! - tR, cb[i]! - tB) > COIN_CHROMA;
      // Close over the coin's embossing and highlights (≈ 1/6 of its diameter).
      const kr = Math.max(3, 2 * Math.round((15 * opts.pxPerMm) / k / 12) + 1);
      const kern = s.keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kr, kr)));
      const ppm = opts.pxPerMm / k;
      const minD = 15 * ppm * 0.75;
      const maxD = 40 * ppm * 1.3;
      let best: { cx: number; cy: number; d: number; circ: number; round: number } | null = null;
      // Three masks: brightness (silver coin), colour alone (a brass coin next to a grey stain or
      // shadow, which would merge with it in the other masks), and either.
      for (const test of [darkOrBright, coloured, (i: number) => darkOrBright(i) || coloured(i)]) {
        const mask = s.keep(new cv.Mat(h, w, cv.CV_8UC1));
        const md = mask.data as Uint8Array;
        for (let i = 0; i < gray.length; i++) md[i] = test(i) ? 255 : 0;
        cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kern);
        const contours = s.keep(new cv.MatVector());
        const hier = s.keep(new cv.Mat());
        cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
        const n = contours.size() as number;
        for (let i = 0; i < n; i++) {
          const c = s.keep(contours.get(i));
          const area = cv.contourArea(c) as number;
          const d = 2 * Math.sqrt(area / Math.PI);
          if (d < minD || d > maxD || (c.rows as number) < 5) continue;
          // Roundness from the convex hull's perimeter: a coin's embossing, glare or a JPEG-ragged
          // edge makes the traced outline wiggly (owner's 2-denar photo: 0.72 traced, round shape);
          // a puzzle piece stays far below (its hull is a knobbed square, area well inside it).
          const hull = s.keep(new cv.Mat());
          cv.convexHull(c, hull, false, true);
          const per = cv.arcLength(hull, true) as number;
          const hullArea = cv.contourArea(hull) as number;
          const circ = per > 0 ? (4 * Math.PI * area) / (per * per) : 0;
          if (circ < 0.85 || area < 0.9 * hullArea) continue;
          const e = cv.fitEllipse(c) as { center: { x: number; y: number }; size: { width: number; height: number } };
          const round = Math.min(e.size.width, e.size.height) / Math.max(e.size.width, e.size.height);
          if (round < 0.85) continue;
          if (!best || circ + round > best.circ + best.round) best = { cx: e.center.x, cy: e.center.y, d, circ, round };
        }
      }
      if (!best) return null;
      // 2. Measure at full size: half-way brightness between coin and table, inside a window.
      const cx = (best.cx + 0.5) * k - 0.5;
      const cy = (best.cy + 0.5) * k - 0.5;
      const r = (best.d * k) / 2;
      const x0 = Math.max(0, Math.floor(cx - 1.5 * r));
      const y0 = Math.max(0, Math.floor(cy - 1.5 * r));
      const x1 = Math.min(W - 1, Math.ceil(cx + 1.5 * r));
      const y1 = Math.min(H - 1, Math.ceil(cy + 1.5 * r));
      const lum = (x: number, y: number) => {
        const i = y * rgba.stride + x * 4;
        return 0.299 * rgba.data[i]! + 0.587 * rgba.data[i + 1]! + 0.114 * rgba.data[i + 2]!;
      };
      // Coin level: median inside 0.6 r; table level: median of the ring 1.25–1.45 r.
      const inside: number[] = [];
      const ring: number[] = [];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const q = Math.hypot(x - cx, y - cy) / r;
          if (q < 0.6) inside.push(lum(x, y));
          else if (q > 1.25 && q < 1.45) ring.push(lum(x, y));
        }
      }
      const med = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
      const coinL = med(inside);
      const tableL = med(ring);
      const half = (coinL + tableL) / 2;
      const coinDarker = coinL < tableL;
      const onCoin = (v: number) => (coinDarker ? v < half : v > half);
      // Brightness and colour (distance from the table's chromaticity, × COIN_CHROMA_GAIN, so a
      // brass rim as bright as the table still shows), bilinear at a sub-pixel position.
      const sample = (x: number, y: number): [number, number] => {
        const xi = Math.max(0, Math.min(W - 2, Math.floor(x)));
        const yi = Math.max(0, Math.min(H - 2, Math.floor(y)));
        const fx = x - xi;
        const fy = y - yi;
        let R = 0;
        let G = 0;
        let B = 0;
        for (const [px, py, wgt] of [
          [xi, yi, (1 - fx) * (1 - fy)],
          [xi + 1, yi, fx * (1 - fy)],
          [xi, yi + 1, (1 - fx) * fy],
          [xi + 1, yi + 1, fx * fy],
        ] as const) {
          const i = py * rgba.stride + px * 4;
          R += rgba.data[i]! * wgt;
          G += rgba.data[i + 1]! * wgt;
          B += rgba.data[i + 2]! * wgt;
        }
        const t = Math.max(1, R + G + B);
        return [0.299 * R + 0.587 * G + 0.114 * B, COIN_CHROMA_GAIN * Math.hypot(R / t - tR, B / t - tB)];
      };
      // The rim along 72 rays between 0.7 r and 1.3 r: the OUTERMOST strong edge (at least half the
      // ray's strongest change in brightness-and-colour), refined to a fraction of a pixel. The
      // outermost, because a coin's embossed inner ring can be a stronger edge than its rim (a shiny
      // brass coin on a cream table); the coin's shiny middle doesn't matter.
      void onCoin;
      const radii: number[] = [];
      const STEP = 0.25;
      const smooth = (v: number[]) =>
        v.map((_, i) => {
          let t = 0;
          let n = 0;
          for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < v.length) (t += v[j]!), n++;
          return t / n;
        });
      for (let a = 0; a < 72; a++) {
        const th = (a * Math.PI) / 36;
        const dx = Math.cos(th);
        const dy = Math.sin(th);
        const pY: number[] = [];
        const pC: number[] = [];
        for (let q = 0.7 * r; q <= 1.3 * r; q += STEP) {
          const [yv, cv2] = sample(cx + dx * q, cy + dy * q);
          pY.push(yv);
          pC.push(cv2);
        }
        // Light smoothing (1 px) before differentiating.
        const sY = smooth(pY);
        const sC = smooth(pC);
        const g = sY.map((_, i) => (i < 1 || i >= sY.length - 1 ? 0 : Math.hypot(sY[i + 1]! - sY[i - 1]!, sC[i + 1]! - sC[i - 1]!)));
        const gMax = Math.max(...g);
        if (gMax < 8) continue;
        let bi = -1;
        for (let i = g.length - 3; i >= 2; i--)
          if (g[i]! >= 0.5 * gMax && g[i]! >= g[i - 1]! && g[i]! >= g[i + 1]!) {
            bi = i;
            break;
          }
        if (bi < 2) continue;
        const g0 = g[bi - 1]!;
        const g1 = g[bi]!;
        const g2 = g[bi + 1]!;
        const den = g0 - 2 * g1 + g2;
        const off = den !== 0 ? Math.max(-1, Math.min(1, (0.5 * (g0 - g2)) / den)) : 0;
        radii.push(0.7 * r + (bi + off) * STEP);
      }
      if (radii.length < 36) return null;
      radii.sort((p, q) => p - q);
      // A contact shadow (and a touching piece) can only make the coin look BIGGER, and with side
      // light it covers up to half the rim; the 30th percentile reads the shadow-free side.
      const meanR = radii[Math.floor(0.3 * radii.length)]!;
      return { centre: [cx, cy], diameterPx: 2 * meanR, circularity: best.circ, roundness: best.round };
    }),
  );
}
