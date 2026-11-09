/**
 * Live view without markers (M5 part 1): where the camera is over the table, found from the
 * pieces themselves. The puzzle's overview photos are the reference: their ORB features (corners
 * in the pieces' print) are kept with their place on the table in mm. Each live frame is matched
 * to them (ORB + ratio test + RANSAC homography), and between those matches the points are
 * followed with optical flow (Lucas–Kanade), which is much cheaper. The result maps table mm into
 * the frame, so the catalog's piece outlines can be drawn on the live picture.
 *
 * Measured on the owner's photos IMG_9263 (landscape) → IMG_9264 (portrait, turned 90°): 462 of
 * 488 matches agree; ORB 8 ms, matching 32 ms per frame on the Mac (960 px frame, 2,500
 * reference features). Flow frames take a few ms.
 *
 * Pieces moved since the photo are outliers to RANSAC; the white table has hardly any features.
 * Runs in the tracker worker and in Node tests alike (no browser APIs here).
 */
import { applyH, invertH, mulH } from '../geo/homography';
import type { Mat3, Vec2 } from '../project/types';
import type { Cv } from './loadCv';
import type { PixelBuffer } from './frameAnalyser';
import { freePersistent, persistent, withScope } from './scope';
import { judgePresence, pieceContrast, type PresencePiece } from './presence';

/** Check which known pieces are still at their spots every this many fixes. */
export const PRESENCE_EVERY = 4;

export const ANCHOR = {
  /** Reference photos are read at this long side (px). */
  refMaxSide: 1280,
  /** ORB features kept per reference photo. */
  refFeatures: 2500,
  /** Reference features kept in all (several overview photos). */
  refTotal: 6000,
  /** ORB features looked for in a live frame. */
  frameFeatures: 1000,
  /** Lowe's ratio test: best match clearly better than the second best. */
  ratio: 0.8,
  /**
   * Guided matching after the first fit: each frame feature is compared only with reference
   * features the fit puts within this many px (analysis px), first wide, then narrow. Finds many
   * more right matches where the print repeats (a finished puzzle's seams) and spreads them over the
   * whole view, so the fit holds at the edges too (owner's IMG_9272 → IMG_9280).
   */
  guideRadii: [24, 8] as readonly number[],
  /** Guided: the best local match must be at most this far (Hamming bits of 256)… */
  guideMaxBits: 64,
  /** …and clearly better than the second-best local one. */
  guideRatio: 0.85,
  /** RANSAC threshold for the guided fits (analysis px). */
  guideRansacPx: 3,
  /** RANSAC: a point this far (analysis px) from where the fit puts it is an outlier. */
  ransacPx: 4,
  /** Fewer agreeing points than this: no fix (not enough of the table recognised). */
  minInliers: 20,
  /** This many agreeing points (and most of them agreeing): a good fix. */
  goodInliers: 40,
  /** Follow points with optical flow between full matches; match again after this many frames. */
  redetectEvery: 6,
  /** Points followed by flow (the agreeing ones, at most this many). */
  maxFlowPoints: 400,
  /** Too few points left to follow: match again now. */
  minFlowPoints: 30,
  /** LK: tracking error above this is a lost point. */
  maxFlowErr: 30,
  /** Plausible scale (analysis px per mm). */
  minPxPerMm: 0.25,
  maxPxPerMm: 40,
  /** Plausible shape: a square on the table may look at most this stretched (tilt ≲ 50°). */
  maxStretch: 2.2,
};

export type AnchorVia = 'features' | 'flow';

export interface AnchorFix {
  /** Table mm → image px (of the image that was passed in). */
  tableToImg: Mat3;
  imgToTable: Mat3;
  /** Agreeing points. */
  inliers: number;
  /** Candidate points (matches after the ratio test, or points followed). */
  candidates: number;
  via: AnchorVia;
  /** 'good': many points agree; 'weak': a fix, but on few points. */
  quality: 'good' | 'weak';
  /** Image px per mm at the image centre. */
  pxPerMm: number;
  /** Every few fixes (M5 part 4): known pieces in view that look gone from their spot, and ones seen there. */
  presence?: { gone: string[]; there: string[] };
}

export interface AnchorReference {
  /** A picture of the table (any size; ANCHOR.refMaxSide is plenty), grey or RGBA. */
  pixels: PixelBuffer;
  channels: 1 | 4;
  /** That picture's px → table mm. */
  imgToTable: Mat3;
}

type Mat = {
  delete(): void;
  data: Uint8Array;
  data32F: Float32Array;
  data64F: Float64Array;
  rows: number;
  cols: number;
  copyTo(m: Mat): void;
  empty(): boolean;
};

/** Maps an image shrunk by `scale` back up: px_big = (px_small + 0.5) · scale − 0.5, as a matrix. */
export function upscaleH(scale: number): Mat3 {
  const o = 0.5 * scale - 0.5;
  return [scale, 0, o, 0, scale, o, 0, 0, 1];
}

/**
 * Whether a table → image mapping is physically plausible: right way round (no mirror), a sane
 * scale, and a 10 mm square around the image centre not stretched beyond ANCHOR.maxStretch.
 */
export function plausible(tableToImg: Mat3, imgW: number, imgH: number): { ok: boolean; pxPerMm: number } {
  const inv = invertH(tableToImg);
  if (!inv) return { ok: false, pxPerMm: 0 };
  const c = applyH(inv, [imgW / 2, imgH / 2]);
  if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return { ok: false, pxPerMm: 0 };
  const p0 = applyH(tableToImg, c);
  const px = applyH(tableToImg, [c[0] + 10, c[1]]);
  const py = applyH(tableToImg, [c[0], c[1] + 10]);
  const ax: Vec2 = [px[0] - p0[0], px[1] - p0[1]];
  const ay: Vec2 = [py[0] - p0[0], py[1] - p0[1]];
  const lx = Math.hypot(ax[0], ax[1]);
  const ly = Math.hypot(ay[0], ay[1]);
  const cross = ax[0] * ay[1] - ax[1] * ay[0];
  const pxPerMm = Math.sqrt(Math.abs(cross)) / 10;
  if (!(lx > 0 && ly > 0) || cross <= 0) return { ok: false, pxPerMm };
  // The denominator of the homography must stay positive over the whole image (no horizon inside it).
  for (const [x, y] of [
    [0, 0],
    [imgW, 0],
    [imgW, imgH],
    [0, imgH],
  ] as Vec2[]) {
    const w = inv[6]! * x + inv[7]! * y + inv[8]!;
    if (!(w > 0)) return { ok: false, pxPerMm };
  }
  const stretch = Math.max(lx / ly, ly / lx, (lx * ly) / Math.abs(cross));
  const ok = pxPerMm >= ANCHOR.minPxPerMm && pxPerMm <= ANCHOR.maxPxPerMm && stretch <= ANCHOR.maxStretch;
  return { ok, pxPerMm };
}

/** A fit with its agreeing points (table mm and image px). */
interface Fitted {
  fix: AnchorFix;
  keepMm: number[];
  keepPx: number[];
}

/** Set bits in each byte value (Hamming distance of ORB descriptors). */
const POPCOUNT = Uint8Array.from({ length: 256 }, (_, v) => {
  let c = 0;
  for (let x = v; x; x >>= 1) c += x & 1;
  return c;
});

export class TableAnchor {
  private readonly cv: Cv;
  private refDesc: Mat | null = null;
  /** Reference features' places on the table (mm), x0, y0, x1, y1, … */
  private refMm = new Float32Array(0);
  /** Reference descriptors (32 bytes each), also kept here for guided matching. */
  private refBytes = new Uint8Array(0);
  private orb: { delete(): void; detectAndCompute: (...a: unknown[]) => void } | null = null;
  private matcher: { delete(): void; knnMatch: (...a: unknown[]) => void } | null = null;
  private prev: Mat | null = null;
  /** Points followed by flow: where they are in the previous frame (px) and on the table (mm). */
  private flowPx: Float32Array | null = null;
  private flowMm: Float32Array | null = null;
  private sinceMatch = 0;
  /** Reference features in all. */
  features = 0;
  /** Known pieces to check for presence, with how much each stood out in the reference photos. */
  private pieces: PresencePiece[] = [];
  private base = new Map<string, number>();
  private fixes = 0;

  constructor(cv: Cv) {
    this.cv = cv;
  }

  get ready(): boolean {
    return this.refDesc !== null && this.features >= ANCHOR.minInliers;
  }

  /** Replaces the reference (the puzzle's overview photos). Returns the number of features kept. */
  setReferences(refs: AnchorReference[], pieces: PresencePiece[] = []): number {
    const cv = this.cv;
    this.clearReferences();
    if (!refs.length) return 0;
    this.pieces = pieces;
    this.base = new Map();
    const per = Math.min(ANCHOR.refFeatures, Math.floor(ANCHOR.refTotal / refs.length));
    const descs: Uint8Array[] = [];
    const mms: number[] = [];
    withScope((s) => {
      const orb = s.keep(new cv.ORB(per));
      const none = s.keep(new cv.Mat());
      for (const ref of refs) {
        const g = s.keep(grayMat(cv, ref.pixels, ref.channels));
        // How much each known piece stands out here (the presence check's yardstick).
        const toImg = invertH(ref.imgToTable);
        if (toImg && pieces.length) {
          const img = { data: g.data as Uint8Array, width: g.cols as number, height: g.rows as number, stride: g.cols as number };
          for (const p of pieces) {
            const c = pieceContrast(img, toImg, p, 0);
            if (c !== null) this.base.set(p.id, Math.max(this.base.get(p.id) ?? 0, c));
          }
        }
        const kps = s.keep(new cv.KeyPointVector());
        const desc = s.keep(new cv.Mat());
        orb.detectAndCompute(g, none, kps, desc);
        const n = kps.size() as number;
        if (!n || desc.rows !== n) continue;
        const d = desc.data as Uint8Array;
        for (let i = 0; i < n; i++) {
          const pt = kps.get(i).pt as { x: number; y: number };
          const mm = applyH(ref.imgToTable, [pt.x, pt.y]);
          if (!Number.isFinite(mm[0]) || !Number.isFinite(mm[1])) continue;
          mms.push(mm[0], mm[1]);
          descs.push(d.slice(i * 32, i * 32 + 32));
        }
      }
    });
    if (descs.length < ANCHOR.minInliers) return 0;
    const all = new Uint8Array(descs.length * 32);
    descs.forEach((d, i) => all.set(d, i * 32));
    const refDesc: Mat = persistent(new cv.Mat(descs.length, 32, cv.CV_8UC1));
    refDesc.data.set(all);
    this.refDesc = refDesc;
    this.refMm = Float32Array.from(mms);
    this.refBytes = all;
    this.features = descs.length;
    this.orb = persistent(new cv.ORB(ANCHOR.frameFeatures));
    this.matcher = persistent(new cv.BFMatcher(cv.NORM_HAMMING, false));
    this.reset();
    return this.features;
  }

  /** Forget where the camera was (e.g. the camera restarted): the next frame is matched afresh. */
  reset(): void {
    this.flowPx = this.flowMm = null;
    this.sinceMatch = 0;
  }

  /**
   * Where the camera is over the table, from one grey frame (any size; ~960 px wide is plenty).
   * Null: the table isn't recognised in this frame.
   */
  track(gray: Mat): AnchorFix | null {
    if (!this.ready) return null;
    let fix: AnchorFix | null = null;
    if (
      this.prev &&
      this.flowPx &&
      this.flowPx.length / 2 >= ANCHOR.minFlowPoints &&
      this.sinceMatch < ANCHOR.redetectEvery &&
      this.prev.rows === gray.rows &&
      this.prev.cols === gray.cols
    ) {
      fix = this.byFlow(gray);
      if (fix) this.sinceMatch++;
    }
    if (!fix) {
      fix = this.byFeatures(gray);
      this.sinceMatch = 0;
    }
    if (!fix) this.flowPx = this.flowMm = null;
    // Every PRESENCE_EVERY fixes: which known pieces are still at their spots.
    if (fix && this.pieces.length && ++this.fixes % PRESENCE_EVERY === 0) {
      const img = { data: gray.data, width: gray.cols, height: gray.rows, stride: gray.cols };
      const gone: string[] = [];
      const there: string[] = [];
      for (const p of this.pieces) {
        const j = judgePresence(pieceContrast(img, fix.tableToImg, p, fix.pxPerMm), this.base.get(p.id));
        if (j === 'gone') gone.push(p.id);
        else if (j === 'there') there.push(p.id);
      }
      fix.presence = { gone, there };
    }
    const prev: Mat = (this.prev ??= persistent(new this.cv.Mat()));
    gray.copyTo(prev);
    return fix;
  }

  private byFeatures(gray: Mat): AnchorFix | null {
    const cv = this.cv;
    return withScope((s) => {
      const kps = s.keep(new cv.KeyPointVector());
      const desc = s.keep(new cv.Mat());
      const none = s.keep(new cv.Mat());
      this.orb!.detectAndCompute(gray, none, kps, desc);
      const n = kps.size() as number;
      if (n < ANCHOR.minInliers || desc.rows !== n) return null;
      const knn = s.keep(new cv.DMatchVectorVector());
      this.matcher!.knnMatch(desc, this.refDesc, knn, 2);
      const mm: number[] = [];
      const px: number[] = [];
      const m = knn.size() as number;
      for (let i = 0; i < m; i++) {
        const v = s.keep(knn.get(i));
        if ((v.size() as number) < 2) continue;
        const a = v.get(0) as { queryIdx: number; trainIdx: number; distance: number };
        const b = v.get(1) as { distance: number };
        if (a.distance >= ANCHOR.ratio * b.distance) continue;
        const pt = kps.get(a.queryIdx).pt as { x: number; y: number };
        mm.push(this.refMm[a.trainIdx * 2]!, this.refMm[a.trainIdx * 2 + 1]!);
        px.push(pt.x, pt.y);
      }
      let best = this.fit(mm, px, gray.cols, gray.rows, 'features', ANCHOR.ransacPx);
      if (!best) return null;
      // Guided matching around the first fit.
      const xy = new Float32Array(2 * n);
      for (let i = 0; i < n; i++) {
        const pt = kps.get(i).pt as { x: number; y: number };
        xy[2 * i] = pt.x;
        xy[2 * i + 1] = pt.y;
      }
      const fd = Uint8Array.from(desc.data as Uint8Array);
      for (const r of ANCHOR.guideRadii) {
        const g = this.guided(best.fix.tableToImg, xy, fd, gray.cols, gray.rows, r);
        const next = this.fit(g.mm, g.px, gray.cols, gray.rows, 'features', ANCHOR.guideRansacPx);
        if (!next || next.fix.inliers < best.fix.inliers) break;
        best = next;
      }
      this.keepForFlow(best);
      return best.fix;
    });
  }

  /** Each frame feature against the reference features `tableToImg` puts within `radius` px of it. */
  private guided(tableToImg: Mat3, xy: Float32Array, desc: Uint8Array, w: number, h: number, radius: number): { mm: number[]; px: number[] } {
    const H = tableToImg;
    const gw = Math.ceil((w + 2 * radius) / radius) + 1;
    const gh = Math.ceil((h + 2 * radius) / radius) + 1;
    const buckets: number[][] = Array.from({ length: gw * gh }, () => []);
    const proj = new Float32Array(this.features * 2);
    for (let j = 0; j < this.features; j++) {
      const X = this.refMm[2 * j]!;
      const Y = this.refMm[2 * j + 1]!;
      const d = H[6]! * X + H[7]! * Y + H[8]!;
      if (!(d > 0)) continue;
      const x = (H[0]! * X + H[1]! * Y + H[2]!) / d;
      const y = (H[3]! * X + H[4]! * Y + H[5]!) / d;
      if (!(x >= -radius && y >= -radius && x <= w + radius && y <= h + radius)) continue;
      proj[2 * j] = x;
      proj[2 * j + 1] = y;
      buckets[Math.floor((y + radius) / radius) * gw + Math.floor((x + radius) / radius)]!.push(j);
    }
    const ref = this.refBytes;
    const mm: number[] = [];
    const px: number[] = [];
    const r2 = radius * radius;
    for (let i = 0; i < xy.length / 2; i++) {
      const x = xy[2 * i]!;
      const y = xy[2 * i + 1]!;
      const bx = Math.floor((x + radius) / radius);
      const by = Math.floor((y + radius) / radius);
      let d1 = 999;
      let d2 = 999;
      let j1 = -1;
      for (let yy = by - 1; yy <= by + 1; yy++)
        for (let xx = bx - 1; xx <= bx + 1; xx++) {
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          for (const j of buckets[yy * gw + xx]!) {
            const dx = proj[2 * j]! - x;
            const dy = proj[2 * j + 1]! - y;
            if (dx * dx + dy * dy > r2) continue;
            let bits = 0;
            for (let b = 0; b < 32; b++) bits += POPCOUNT[desc[i * 32 + b]! ^ ref[j * 32 + b]!]!;
            if (bits < d1) {
              d2 = d1;
              d1 = bits;
              j1 = j;
            } else if (bits < d2) d2 = bits;
          }
        }
      if (j1 < 0 || d1 > ANCHOR.guideMaxBits || d1 >= ANCHOR.guideRatio * d2) continue;
      mm.push(this.refMm[2 * j1]!, this.refMm[2 * j1 + 1]!);
      px.push(x, y);
    }
    return { mm, px };
  }

  private byFlow(gray: Mat): AnchorFix | null {
    const cv = this.cv;
    const prevPx = this.flowPx!;
    const prevMm = this.flowMm!;
    return withScope((s) => {
      const n = prevPx.length / 2;
      const p0 = s.keep(cv.matFromArray(n, 1, cv.CV_32FC2, Array.from(prevPx)));
      const p1 = s.keep(new cv.Mat());
      const status = s.keep(new cv.Mat());
      const err = s.keep(new cv.Mat());
      const crit = new cv.TermCriteria(cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 20, 0.03);
      cv.calcOpticalFlowPyrLK(this.prev, gray, p0, p1, status, err, new cv.Size(21, 21), 3, crit);
      const st = status.data as Uint8Array;
      const e = err.data32F;
      const q = p1.data32F;
      const mm: number[] = [];
      const px: number[] = [];
      const w = gray.cols;
      const h = gray.rows;
      for (let i = 0; i < n; i++) {
        if (!st[i] || !(e[i]! <= ANCHOR.maxFlowErr)) continue;
        const x = q[2 * i]!;
        const y = q[2 * i + 1]!;
        if (!(x >= 0 && y >= 0 && x < w && y < h)) continue;
        mm.push(prevMm[2 * i]!, prevMm[2 * i + 1]!);
        px.push(x, y);
      }
      const fit = this.fit(mm, px, w, h, 'flow', ANCHOR.ransacPx);
      // Most followed points must still agree; otherwise match afresh.
      if (!fit || fit.fix.inliers < 0.6 * n) return null;
      this.keepForFlow(fit);
      return fit.fix;
    });
  }

  /** Follow at most maxFlowPoints of the agreeing points into the next frame (spread: every k-th). */
  private keepForFlow(f: Fitted): void {
    const inliers = f.keepMm.length / 2;
    const step = Math.max(1, Math.ceil(inliers / ANCHOR.maxFlowPoints));
    const fm: number[] = [];
    const fp: number[] = [];
    for (let i = 0; i < inliers; i += step) {
      fm.push(f.keepMm[2 * i]!, f.keepMm[2 * i + 1]!);
      fp.push(f.keepPx[2 * i]!, f.keepPx[2 * i + 1]!);
    }
    this.flowMm = Float32Array.from(fm);
    this.flowPx = Float32Array.from(fp);
  }

  /** RANSAC homography table mm → image px, with the agreeing points. */
  private fit(mm: number[], px: number[], w: number, h: number, via: AnchorVia, ransacPx: number): Fitted | null {
    const cv = this.cv;
    const n = mm.length / 2;
    if (n < ANCHOR.minInliers) return null;
    return withScope((s) => {
      const src = s.keep(cv.matFromArray(n, 1, cv.CV_32FC2, mm));
      const dst = s.keep(cv.matFromArray(n, 1, cv.CV_32FC2, px));
      const mask = s.keep(new cv.Mat());
      const Hm = s.keep(cv.findHomography(src, dst, cv.RANSAC, ransacPx, mask, 2000, 0.995));
      if (Hm.empty() || Hm.rows !== 3) return null;
      const H = Array.from(Hm.data64F) as Mat3;
      const k = mask.data as Uint8Array;
      const keepMm: number[] = [];
      const keepPx: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!k[i]) continue;
        keepMm.push(mm[2 * i]!, mm[2 * i + 1]!);
        keepPx.push(px[2 * i]!, px[2 * i + 1]!);
      }
      const inliers = keepMm.length / 2;
      if (inliers < ANCHOR.minInliers) return null;
      const norm = H.map((v) => v / H[8]!) as Mat3;
      const pl = plausible(norm, w, h);
      if (!pl.ok) return null;
      const inv = invertH(norm);
      if (!inv) return null;
      const quality = inliers >= ANCHOR.goodInliers && inliers >= 0.3 * n ? 'good' : 'weak';
      return { fix: { tableToImg: norm, imgToTable: inv, inliers, candidates: n, via, quality, pxPerMm: pl.pxPerMm }, keepMm, keepPx };
    });
  }

  private clearReferences(): void {
    this.pieces = [];
    this.base = new Map();
    for (const m of [this.refDesc, this.orb, this.matcher]) if (m) freePersistent(m);
    this.refDesc = this.orb = this.matcher = null;
    this.refMm = new Float32Array(0);
    this.refBytes = new Uint8Array(0);
    this.features = 0;
    this.reset();
  }

  dispose(): void {
    this.clearReferences();
    if (this.prev) freePersistent(this.prev);
    this.prev = null;
  }
}

/** A grey Mat (caller deletes) from a 1-channel buffer, or from RGBA (converted). */
export function grayMat(cv: Cv, buf: PixelBuffer, ch: 1 | 4): Mat {
  const m: Mat = new cv.Mat(buf.height, buf.width, ch === 4 ? cv.CV_8UC4 : cv.CV_8UC1);
  const row = buf.width * ch;
  for (let y = 0; y < buf.height; y++) m.data.set(buf.data.subarray(y * buf.stride, y * buf.stride + row), y * row);
  if (ch === 1) return m;
  const g: Mat = new cv.Mat();
  try {
    cv.cvtColor(m, g, cv.COLOR_RGBA2GRAY);
  } finally {
    m.delete();
  }
  return g;
}

/** Table mm → image px for an image shrunk by `scale` from the one the fix was made on… and back. */
export function scaleFix(fix: AnchorFix, scale: number): AnchorFix {
  if (scale === 1) return fix;
  const tableToImg = mulH(upscaleH(scale), fix.tableToImg);
  const imgToTable = invertH(tableToImg) ?? fix.imgToTable;
  return { ...fix, tableToImg, imgToTable, pxPerMm: fix.pxPerMm * scale };
}
