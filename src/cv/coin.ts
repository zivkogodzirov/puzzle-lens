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
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let dy = 0; dy < k; dy++) {
            const row = (y * k + dy) * rgba.stride;
            for (let dx = 0; dx < k; dx++) {
              const i = row + (x * k + dx) * 4;
              sum += 0.299 * rgba.data[i]! + 0.587 * rgba.data[i + 1]! + 0.114 * rgba.data[i + 2]!;
            }
          }
          gray[y * w + x] = Math.round(sum / (k * k));
        }
      }
      const hist = new Uint32Array(256);
      for (const v of gray) hist[v]!++;
      let table = 200;
      for (let v = 255, best = -1; v >= 64; v--) if (hist[v]! > best) [best, table] = [hist[v]!, v];
      const mask = s.keep(new cv.Mat(h, w, cv.CV_8UC1));
      const md = mask.data as Uint8Array;
      const thr = Math.max(14, 0.1 * table);
      for (let i = 0; i < gray.length; i++) md[i] = Math.abs(gray[i]! - table) > thr ? 255 : 0;
      const kern = s.keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)));
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kern);
      const contours = s.keep(new cv.MatVector());
      const hier = s.keep(new cv.Mat());
      cv.findContours(mask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
      const ppm = opts.pxPerMm / k;
      const minD = 15 * ppm * 0.75;
      const maxD = 40 * ppm * 1.3;
      let best: { cx: number; cy: number; d: number; circ: number; round: number } | null = null;
      const n = contours.size() as number;
      for (let i = 0; i < n; i++) {
        const c = s.keep(contours.get(i));
        const area = cv.contourArea(c) as number;
        const d = 2 * Math.sqrt(area / Math.PI);
        if (d < minD || d > maxD || (c.rows as number) < 5) continue;
        const per = cv.arcLength(c, true) as number;
        const circ = per > 0 ? (4 * Math.PI * area) / (per * per) : 0;
        if (circ < 0.85) continue;
        const e = cv.fitEllipse(c) as { center: { x: number; y: number }; size: { width: number; height: number } };
        const round = Math.min(e.size.width, e.size.height) / Math.max(e.size.width, e.size.height);
        if (round < 0.85) continue;
        if (!best || circ + round > best.circ + best.round) best = { cx: e.center.x, cy: e.center.y, d, circ, round };
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
      const sample = (x: number, y: number) => {
        const xi = Math.max(0, Math.min(W - 2, Math.floor(x)));
        const yi = Math.max(0, Math.min(H - 2, Math.floor(y)));
        const fx = x - xi;
        const fy = y - yi;
        return lum(xi, yi) * (1 - fx) * (1 - fy) + lum(xi + 1, yi) * fx * (1 - fy) + lum(xi, yi + 1) * (1 - fx) * fy + lum(xi + 1, yi + 1) * fx * fy;
      };
      // The edge along 72 rays: where brightness changes fastest between 0.7 r and 1.3 r (the rim
      // against the table), refined to a fraction of a pixel. This doesn't depend on the coin's
      // shiny, embossed middle.
      void onCoin;
      const radii: number[] = [];
      const STEP = 0.25;
      for (let a = 0; a < 72; a++) {
        const th = (a * Math.PI) / 36;
        const dx = Math.cos(th);
        const dy = Math.sin(th);
        const prof: number[] = [];
        for (let q = 0.7 * r; q <= 1.3 * r; q += STEP) prof.push(sample(cx + dx * q, cy + dy * q));
        // Light smoothing (1 px) before differentiating.
        const sm = prof.map((_, i) => {
          let t = 0;
          let n = 0;
          for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < prof.length) (t += prof[j]!), n++;
          return t / n;
        });
        let bi = -1;
        let bg = 0;
        for (let i = 1; i < sm.length - 1; i++) {
          const g = Math.abs(sm[i + 1]! - sm[i - 1]!);
          if (g > bg) [bg, bi] = [g, i];
        }
        if (bi < 2 || bi > sm.length - 3 || bg < 8) continue;
        const g0 = Math.abs(sm[bi]! - sm[bi - 2]!);
        const g1 = bg;
        const g2 = Math.abs(sm[bi + 2]! - sm[bi]!);
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
