/**
 * The catalog (PLAN §6 M2): pieces found in a scan photo are merged into the puzzle's pieces.
 * A piece found again at the same table position (same size) is the same piece — it is updated,
 * never added twice.
 *
 * Moved pieces (owner's report 2026-11-08: "if I move a piece a little it counts as a new one"):
 * when the photo's view is known, a known piece whose spot lies well inside the view and is now
 * EMPTY (nothing found there, not even a clump) has left that spot. Each piece that would be new is
 * first compared with those pieces and with pieces already missing, by shape (outline radius
 * around the centre, best rotation), size and colour; a clear, unambiguous match is the same piece,
 * moved. Pieces that left and matched nothing are marked "missing" (not on the table any more; they
 * come back if found at that spot again). Full fingerprints for lookalikes come in M5.
 */
import type { PieceFlags, PiecePatchInfo, PieceRow, Vec2 } from './types';

/** What the reader reports for each piece in a photo (src/cv/pieceFinder.ts FoundPiece, plus a thumbnail). */
export interface FoundForCatalog {
  outlineMm: number[];
  centreMm: Vec2;
  angleDeg: number;
  areaMm2: number;
  sizeMm: Vec2;
  meanLab: [number, number, number];
  hueHist: number[];
  flags: PieceFlags;
  thumb?: Blob | null;
  /** The piece straightened for box placement (M4). */
  patch?: { blob: Blob; flats: boolean[]; sure: boolean; sides?: string; sideConf?: number[] } | null;
}

export interface MergePlan {
  /** Existing pieces to update (same id), including moved ones and ones now missing. */
  updates: PieceRow[];
  /** Of those: recognised at a new spot (moved), and no longer seen at their spot (missing). */
  moved: number;
  missing: number;
  /** New pieces. */
  added: PieceRow[];
  /** Thumbnails to store: blob id → JPEG. */
  thumbs: Array<{ id: string; blob: Blob }>;
  /** Placement patches to store: blob id → raw RGBA. */
  patches: Array<{ id: string; blob: Blob }>;
  /** Found pieces left out (cut by the photo edge and not known yet). */
  skipped: number;
}

/** Two sightings are the same piece when their centres are this close (share of the piece's size)… */
export const SAME_PIECE_DIST = 0.35;
/** …and their areas differ by less than this share. */
export const SAME_PIECE_AREA = 0.3;
/**
 * A moved piece: mean outline-radius difference at the best rotation at most this (mm)… Many
 * pieces of a puzzle share a knob pattern and differ by only ~0.3–0.5 mm on this measure, so it
 * can't tell any piece from any other; it only picks among the few pieces that just left their
 * spot (or are missing), and gives up when two of them fit about equally well (MOVED_MARGIN).
 */
export const MOVED_SHAPE_MM = 0.6;
/** …area within this share, colour within this ΔE (Lab), and the runner-up this much worse. */
export const MOVED_AREA = 0.2;
export const MOVED_DELTA_E = 12;
export const MOVED_MARGIN = 1.35;
/** A piece is marked missing only by a photo with at least this × its best pixels per mm. */
export const MISSING_MIN_SHARPNESS = 0.85;
/** A known spot counts as in view when at least this × the piece's size from the view's edge. */
export const VIEW_INSET = 0.8;

/** Outline radius around the centre at `SIG_N` angles (max radius per angle bin, gaps filled). */
const SIG_N = 72;
export function shapeSignature(rel: number[]): Float32Array {
  const sig = new Float32Array(SIG_N).fill(-1);
  const n = rel.length / 2;
  // Densify long edges so every angle bin gets a sample.
  for (let i = 0; i < n; i++) {
    const x0 = rel[2 * i]!;
    const y0 = rel[2 * i + 1]!;
    const x1 = rel[2 * ((i + 1) % n)]!;
    const y1 = rel[2 * ((i + 1) % n) + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.5));
    for (let k = 0; k < steps; k++) {
      const x = x0 + ((x1 - x0) * k) / steps;
      const y = y0 + ((y1 - y0) * k) / steps;
      const b = Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * SIG_N) % SIG_N;
      sig[b] = Math.max(sig[b]!, Math.hypot(x, y));
    }
  }
  for (let b = 0; b < SIG_N; b++) {
    if (sig[b]! >= 0) continue;
    let l = 1;
    while (l < SIG_N && sig[(b - l + SIG_N) % SIG_N]! < 0) l++;
    let r = 1;
    while (r < SIG_N && sig[(b + r) % SIG_N]! < 0) r++;
    const a = sig[(b - l + SIG_N) % SIG_N]!;
    const c = sig[(b + r) % SIG_N]!;
    sig[b] = a < 0 || c < 0 ? Math.max(a, c, 0) : a + ((c - a) * l) / (l + r);
  }
  return sig;
}

/** Mean |radius difference| (mm) at the best rotation (pieces lie face up: no mirroring). */
export function shapeDistance(a: Float32Array, b: Float32Array): number {
  let best = Infinity;
  for (let s = 0; s < SIG_N; s++) {
    let d = 0;
    for (let i = 0; i < SIG_N && d < best * SIG_N; i++) d += Math.abs(a[i]! - b[(i + s) % SIG_N]!);
    best = Math.min(best, d / SIG_N);
  }
  return best;
}

function deltaE(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

/** Point inside a polygon (even-odd), and its distance to the polygon's edges. */
function insideBy(poly: Vec2[], p: Vec2): number {
  let inside = false;
  let dmin = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi;
    const dy = yj - yi;
    const t = Math.max(0, Math.min(1, ((p[0] - xi) * dx + (p[1] - yi) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
    dmin = Math.min(dmin, Math.hypot(p[0] - xi - t * dx, p[1] - yi - t * dy));
  }
  return inside ? dmin : -dmin;
}

function relativeOutline(outlineMm: number[], c: Vec2): number[] {
  const out = new Array<number>(outlineMm.length);
  for (let i = 0; i < outlineMm.length; i += 2) {
    out[i] = outlineMm[i]! - c[0];
    out[i + 1] = outlineMm[i + 1]! - c[1];
  }
  return out;
}

/**
 * Works out how a photo's pieces change the catalog. Pure: the caller writes the result.
 * `pxPerMm` is the photo's scale — a sharper photo replaces a piece's outline, a blurrier one only
 * updates its position and "last seen".
 */
export function planMerge(
  existing: PieceRow[],
  found: FoundForCatalog[],
  ctx: {
    projectId: string;
    snapId: string;
    pxPerMm: number;
    now: number;
    newId: () => string;
    thumbId: (pieceId: string) => string;
    /** Blob id for a piece's placement patch (default: "patch-" + piece id). */
    patchId?: (pieceId: string) => string;
    /** The photo's view on the table (catalog mm, a polygon). Without it, moved pieces aren't looked for. */
    view?: Vec2[] | null;
  },
): MergePlan {
  // Missing pieces too: found again at their old spot, they are simply back.
  const onTable = existing.filter((p) => p.status === 'table' || p.status === 'pending' || p.status === 'missing');
  const taken = new Set<string>();
  const updates: PieceRow[] = [];
  const added: PieceRow[] = [];
  const thumbs: MergePlan['thumbs'] = [];
  const patches: MergePlan['patches'] = [];
  const patchId = ctx.patchId ?? ((pid: string) => `patch-${pid}`);
  /** This photo's patch for a piece (kept under the piece's existing patch id). */
  const takePatch = (f: FoundForCatalog, pieceId: string, old: PiecePatchInfo | null | undefined): PiecePatchInfo | null | undefined => {
    if (!f.patch) return old;
    const id = old?.blobId ?? patchId(pieceId);
    patches.push({ id, blob: f.patch.blob });
    const info: PiecePatchInfo = { blobId: id, flats: f.patch.flats, sure: f.patch.sure, ts: ctx.now };
    if (f.patch.sides) {
      info.sides = f.patch.sides;
      info.sideConf = f.patch.sideConf ?? [1, 1, 1, 1];
    }
    return info;
  };
  let skipped = 0;
  /** Found pieces matched to nobody by position (index into found), to try as moved pieces. */
  const unmatched: number[] = [];
  /** Found pieces matched to a known piece by position. */
  const matched = new Set<number>();
  // Biggest, clearest pieces first, so a clump can't steal a single piece's match.
  const order = found.map((f, i) => i).sort((a, b) => Number(Boolean(found[a]!.flags.clump)) - Number(Boolean(found[b]!.flags.clump)));
  for (const i of order) {
    const f = found[i]!;
    const size = Math.max(f.sizeMm[0], f.sizeMm[1], 1);
    let best: PieceRow | null = null;
    let bestD = Infinity;
    for (const p of onTable) {
      if (taken.has(p.id)) continue;
      const d = Math.hypot(p.table.x - f.centreMm[0], p.table.y - f.centreMm[1]);
      if (d > SAME_PIECE_DIST * size || d >= bestD) continue;
      const areaDiff = Math.abs(p.areaMm2 - f.areaMm2) / Math.max(p.areaMm2, f.areaMm2, 1);
      if (areaDiff > SAME_PIECE_AREA && !f.flags.cut) continue;
      best = p;
      bestD = d;
    }
    if (best) {
      taken.add(best.id);
      matched.add(i);
      const sharper = ctx.pxPerMm > best.bestPxPerMm * 1.15 && !f.flags.cut && !f.flags.clump;
      const next: PieceRow = {
        ...best,
        updatedAt: ctx.now,
        table: {
          x: f.flags.cut ? best.table.x : f.centreMm[0],
          y: f.flags.cut ? best.table.y : f.centreMm[1],
          angleDeg: sharper ? f.angleDeg : best.table.angleDeg,
          lastSeen: ctx.now,
          snapId: ctx.snapId,
        },
        seen: best.seen + 1,
        status: 'table',
      };
      if (sharper) {
        next.outlineMm = relativeOutline(f.outlineMm, f.centreMm);
        next.areaMm2 = f.areaMm2;
        next.sizeMm = f.sizeMm;
        next.colour = { meanLab: f.meanLab, hueHist: f.hueHist };
        next.bestPxPerMm = ctx.pxPerMm;
        next.flags = { ...f.flags };
        if (f.thumb) {
          const id = best.thumbBlobId ?? ctx.thumbId(best.id);
          next.thumbBlobId = id;
          thumbs.push({ id, blob: f.thumb });
        }
        next.patch = takePatch(f, best.id, best.patch);
      } else if (!best.patch && f.patch && !f.flags.cut && !f.flags.clump) next.patch = takePatch(f, best.id, null);
      updates.push(next);
      continue;
    }
    if (f.flags.cut) {
      skipped++;
      continue;
    }
    unmatched.push(i);
  }

  // Moved pieces. Known pieces whose spot is well inside this photo and empty have left it.
  let moved = 0;
  let missing = 0;
  const left: PieceRow[] = [];
  if (ctx.view && ctx.view.length >= 3) {
    for (const p of existing) {
      if (taken.has(p.id) || (p.status !== 'table' && p.status !== 'pending')) continue;
      const size = Math.max(p.sizeMm[0], p.sizeMm[1], 1);
      if (insideBy(ctx.view, [p.table.x, p.table.y]) < VIEW_INSET * size) continue;
      // Something over the spot that could be this piece unrecognised (a clump, a weak or cut blob)
      // means it may still be there. A clean single piece nearby that matched nothing does not: it
      // may be this very piece, moved a little (the owner's case).
      const covered = found.some(
        (f, i) =>
          (f.flags.clump || f.flags.weak || f.flags.cut || matched.has(i)) &&
          Math.hypot(f.centreMm[0] - p.table.x, f.centreMm[1] - p.table.y) < 0.5 * (size + Math.max(f.sizeMm[0], f.sizeMm[1])) * 0.8,
      );
      if (!covered) left.push(p);
    }
  }
  const candidates = [...left, ...existing.filter((p) => p.status === 'missing' && !taken.has(p.id))];
  const sigs = new Map(candidates.map((p) => [p.id, shapeSignature(p.outlineMm)]));
  const newOnes: number[] = [];
  for (const i of unmatched) {
    const f = found[i]!;
    if (f.flags.clump || !candidates.length) {
      newOnes.push(i);
      continue;
    }
    const fs = shapeSignature(relativeOutline(f.outlineMm, f.centreMm));
    let best: PieceRow | null = null;
    let bestD = Infinity;
    let second = Infinity;
    for (const p of candidates) {
      if (taken.has(p.id)) continue;
      if (Math.abs(p.areaMm2 - f.areaMm2) / Math.max(p.areaMm2, f.areaMm2, 1) > MOVED_AREA) continue;
      if (deltaE(p.colour.meanLab, f.meanLab) > MOVED_DELTA_E) continue;
      const d = shapeDistance(fs, sigs.get(p.id)!);
      if (d < bestD) {
        second = bestD;
        bestD = d;
        best = p;
      } else if (d < second) second = d;
    }
    if (!best || bestD > MOVED_SHAPE_MM || second < MOVED_MARGIN * bestD) {
      newOnes.push(i);
      continue;
    }
    taken.add(best.id);
    moved++;
    const sharper = ctx.pxPerMm > best.bestPxPerMm * 1.15 && !f.flags.weak;
    const next: PieceRow = {
      ...best,
      updatedAt: ctx.now,
      status: 'table',
      table: { x: f.centreMm[0], y: f.centreMm[1], angleDeg: f.angleDeg, lastSeen: ctx.now, snapId: ctx.snapId },
      // Its outline is stored relative to the centre and turned with the piece: take this photo's.
      outlineMm: relativeOutline(f.outlineMm, f.centreMm),
      seen: best.seen + 1,
    };
    if (sharper) {
      next.areaMm2 = f.areaMm2;
      next.sizeMm = f.sizeMm;
      next.colour = { meanLab: f.meanLab, hueHist: f.hueHist };
      next.bestPxPerMm = ctx.pxPerMm;
      next.flags = { ...f.flags };
    }
    if (f.thumb) {
      const id = best.thumbBlobId ?? ctx.thumbId(best.id);
      next.thumbBlobId = id;
      thumbs.push({ id, blob: f.thumb });
    }
    next.patch = takePatch(f, best.id, best.patch);
    updates.push(next);
  }
  for (const p of left) {
    if (taken.has(p.id)) continue;
    // Only a clear piece in a photo at least about as sharp as its best one: a pale piece, or a
    // blurrier photo, may simply have missed it (it then stays on the table).
    if (p.flags.weak || p.flags.clump || ctx.pxPerMm < MISSING_MIN_SHARPNESS * p.bestPxPerMm) continue;
    missing++;
    updates.push({ ...p, status: 'missing', updatedAt: ctx.now });
  }

  for (const i of newOnes) {
    const f = found[i]!;
    const id = ctx.newId();
    const thumbBlobId = f.thumb ? ctx.thumbId(id) : null;
    if (f.thumb && thumbBlobId) thumbs.push({ id: thumbBlobId, blob: f.thumb });
    added.push({
      id,
      projectId: ctx.projectId,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      status: 'table',
      table: { x: f.centreMm[0], y: f.centreMm[1], angleDeg: f.angleDeg, lastSeen: ctx.now, snapId: ctx.snapId },
      outlineMm: relativeOutline(f.outlineMm, f.centreMm),
      areaMm2: f.areaMm2,
      sizeMm: f.sizeMm,
      colour: { meanLab: f.meanLab, hueHist: f.hueHist },
      thumbBlobId,
      seen: 1,
      bestPxPerMm: ctx.pxPerMm,
      flags: { ...f.flags },
      patch: takePatch(f, id, null) ?? null,
    });
  }
  return { updates, added, thumbs, patches, skipped, moved, missing };
}

/**
 * The measured piece pitch (cell size) from single pieces (not clumped, not cut). A piece's tabs
 * and blanks roughly cancel out, so its area ≈ one cell; the cell's shape comes from the ratio of
 * the outline box's two sides. First estimate; M3 measures cells from the corners.
 */
export function measurePitch(pieces: Array<{ sizeMm: Vec2; areaMm2: number; flags: PieceFlags }>): { wMm: number; hMm: number; n: number } | null {
  const ok = pieces.filter((p) => !p.flags.clump && !p.flags.cut && p.areaMm2 > 0);
  if (ok.length < 5) return null;
  const med = (v: number[]) => v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
  const area = med(ok.map((p) => p.areaMm2));
  const ratio = med(ok.map((p) => Math.min(p.sizeMm[0], p.sizeMm[1]) / Math.max(p.sizeMm[0], p.sizeMm[1])));
  return { wMm: Math.sqrt(area * ratio), hMm: Math.sqrt(area / ratio), n: ok.length };
}
