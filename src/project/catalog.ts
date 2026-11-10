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
 *
 * Batches (M7): pieces set aside when a new batch was started have no spot on the new table, and
 * by default they are not matched by their picture either (BATCH): a piece spread out again in a
 * new batch is read as a new piece.
 */
import type { PieceFlags, PiecePatchInfo, PieceRow, Vec2 } from './types';
import { fingerprintDistance } from '../cv/fingerprint';

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
  patch?: { blob: Blob; flats: boolean[]; sure: boolean; sides?: string; sideConf?: number[]; light?: number[] | null; fp?: number[] | null } | null;
}

export interface MergePlan {
  /** Existing pieces to update (same id), including moved ones and ones now missing. */
  updates: PieceRow[];
  /** Of those: recognised at a new spot (moved), and no longer seen at their spot (missing). */
  /** Of the moved ones: pieces set aside in an earlier batch, back on the table (M7). */
  back: number;
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
  /**
   * M5 part 3: sightings that may be pieces moved since (unsure which) are added as 'pending' with
   * the pieces they may be (PieceRow.maybe), to be settled by a later scan or by the owner. When a
   * scan settles one, the pending row is merged into the known piece: `merged` (from → into), and
   * the pending row is removed.
   */
  pending: number;
  merged: Array<{ from: string; into: string }>;
  removed: string[];
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
/**
 * M5 part 3: a sighting whose outline overlaps a known piece's by at least this share (of the
 * smaller of the two) at about the same place is that piece, whatever its size: a pale or shadowed
 * piece found only partly, or with glare or a shadow added, is still the same piece (the 30 % area
 * rule alone made duplicates: 5 of 6 on val48, and the owner's IMG_9274 / IMG_9276 rescans).
 */
export const SAME_PIECE_OVERLAP = 0.6;
/**
 * Moved pieces with fingerprints (M5 part 3): the cost of a sighting × a known piece is the
 * fingerprint distance (src/cv/fingerprint.ts, ΔE-like; same piece median ≈ 3, p90 ≈ 10–13 on
 * synthetic and the owner's photos) plus MOVED_SHAPE_WEIGHT × the outline-radius distance (mm).
 * A pair counts up to MOVED_FP_COST, and only when the next choice on either side costs at least
 * MOVED_MARGIN × it + MOVED_MARGIN_ABS. Area and colour gates are looser than without fingerprints
 * (light changes and partial reads).
 */
export const MOVED_FP_COST = 14;
export const MOVED_FP_COST_FREE = 24;
/**
 * Position match refused when both the printed pictures (fingerprint distance) and the outlines
 * (outline-radius distance, mm) differ by more than this. Measured on val48 rescans: right
 * same-spot matches fingerprint p95 20, outline p90 0.8 mm; wrong ones either look alike (no
 * threshold separates them) or differ in both (≈ 23 and 1.5 mm).
 */
export const SAME_PIECE_FP_VETO = 20;
export const SAME_PIECE_SHAPE_VETO = 1.1;
export const MOVED_SHAPE_WEIGHT = 6;
export const MOVED_MARGIN_ABS = 3;
export const MOVED_AREA_FP = 0.35;
export const MOVED_DELTA_E_FP = 20;

/**
 * Pieces set aside in an earlier batch (M7) are not matched by their picture: measured 2026-11-09,
 * a fingerprint can't tell that many pieces apart. Synthetic val300 (a new batch of 100 new + 50
 * returning pieces, 150 set aside): at the strictest cost (8) only 35 % of the returning pieces
 * were recognised and 3.5 % of the NEW pieces were merged into a set-aside one (12: 42 % / 8.7 %);
 * no fingerprint and outline limits together separate them (fp ≤ 6 and outline ≤ 0.3 mm: 33 true
 * pairs, 10 false). On the owner's photos (the same 21 pieces from four places, 12 orders), cost 16
 * recognised 162 of 252 sightings, cost 20 202 with 4 wrong; there were no new pieces to mix up.
 * A wrong merge mixes two pieces up silently; a piece read again is only counted twice, so the
 * default is off (asideCost −1). Kept as a setting for M8 (tuning on the owner's real batches).
 */
export const BATCH = {
  /** Highest cost (fingerprint + shape) for taking a set-aside piece back; −1 = never. */
  asideCost: -1,
  /** Unsure sightings among set-aside pieces become pieces to check. */
  asidePending: false,
};
/** A fragment (an unmatched blob lying this much inside a piece already matched in this photo) is part of it. */
export const FRAGMENT_OVERLAP = 0.5;
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

/** Area of a polygon (flat x, y). */
function polyArea(o: number[]): number {
  let a = 0;
  const n = o.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += o[2 * i]! * o[2 * j + 1]! - o[2 * j]! * o[2 * i + 1]!;
  }
  return Math.abs(a / 2);
}

function inPoly(o: number[], x: number, y: number): boolean {
  let c = false;
  const n = o.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = o[2 * i]!;
    const yi = o[2 * i + 1]!;
    const xj = o[2 * j]!;
    const yj = o[2 * j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function bounds(o: number[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < o.length; i += 2) {
    x0 = Math.min(x0, o[i]!);
    x1 = Math.max(x1, o[i]!);
    y0 = Math.min(y0, o[i + 1]!);
    y1 = Math.max(y1, o[i + 1]!);
  }
  return [x0, y0, x1, y1];
}

/**
 * How much two outlines (absolute mm, flat) overlap: the shared area ÷ the smaller outline's area
 * (0–1), counted on a 0.5 mm grid.
 */
export function outlineOverlap(a: number[], b: number[]): number {
  if (a.length < 6 || b.length < 6) return 0;
  const [ax0, ay0, ax1, ay1] = bounds(a);
  const [bx0, by0, bx1, by1] = bounds(b);
  const x0 = Math.max(ax0, bx0);
  const y0 = Math.max(ay0, by0);
  const x1 = Math.min(ax1, bx1);
  const y1 = Math.min(ay1, by1);
  if (x1 <= x0 || y1 <= y0) return 0;
  const step = 0.5;
  let both = 0;
  for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) if (inPoly(a, x, y) && inPoly(b, x, y)) both++;
  const smaller = Math.min(polyArea(a), polyArea(b));
  return smaller > 0 ? Math.min(1, (both * step * step) / smaller) : 0;
}

/** A known piece's outline in table mm (absolute). */
function absoluteOutline(p: PieceRow): number[] {
  const out = new Array<number>(p.outlineMm.length);
  for (let i = 0; i < p.outlineMm.length; i += 2) {
    out[i] = p.outlineMm[i]! + p.table.x;
    out[i + 1] = p.outlineMm[i + 1]! + p.table.y;
  }
  return out;
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
    if (f.patch.light?.length === 3) info.light = f.patch.light as [number, number, number];
    if (f.patch.fp?.length) info.fp = f.patch.fp;
    return info;
  };
  let skipped = 0;
  /**
   * Another piece put down on a known piece's spot: both printed pictures read, and very different
   * (beyond any same-piece pair seen in testing), so it is not that piece (M5 part 3).
   */
  const vetoed = (f: FoundForCatalog, p: PieceRow): boolean => {
    const a = f.patch?.fp;
    const b = p.patch?.fp;
    if (!a?.length || !b?.length || f.flags.weak || p.flags.weak) return false;
    if (fingerprintDistance(a, b, f.patch?.sides, p.patch?.sides).d <= SAME_PIECE_FP_VETO) return false;
    return shapeDistance(shapeSignature(relativeOutline(f.outlineMm, f.centreMm)), shapeSignature(p.outlineMm)) > SAME_PIECE_SHAPE_VETO;
  };
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
      if (vetoed(f, p)) continue;
      best = p;
      bestD = d;
    }
    // Not found by position and size: the same place with a different size (found partly, or with
    // a shadow or glare added) is still that piece when the outlines overlap well (M5 part 3).
    if (!best && !f.flags.clump) {
      let bestO = SAME_PIECE_OVERLAP;
      for (const p of onTable) {
        if (taken.has(p.id)) continue;
        const reach = 0.5 * Math.max(size, p.sizeMm[0], p.sizeMm[1]);
        if (Math.hypot(p.table.x - f.centreMm[0], p.table.y - f.centreMm[1]) > reach) continue;
        const o = outlineOverlap(absoluteOutline(p), f.outlineMm);
        if (o >= bestO && !vetoed(f, p)) {
          bestO = o;
          best = p;
        }
      }
    }
    if (best) {
      taken.add(best.id);
      matched.add(i);
      // A sharper photo replaces the outline, but never a whole piece by a part of it (a pale edge
      // missed, a "weak" read), while a fuller read replaces a partial one.
      const partial = (f.flags.weak && !best.flags.weak) || f.areaMm2 < 0.75 * best.areaMm2;
      const fuller = Boolean(best.flags.weak) && !f.flags.weak && f.areaMm2 > best.areaMm2;
      const sharper = (ctx.pxPerMm > best.bestPxPerMm * 1.15 || fuller) && !f.flags.cut && !f.flags.clump && !partial;
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
        status: best.status === 'pending' ? 'pending' : 'table',
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
  let back = 0;
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
  // Who may have moved here (M5 part 3): pieces whose spot is in view and now empty, pieces already
  // missing, and pieces whose spot is out of this photo's view (they may have been moved into it).
  // A piece whose spot is in view and still covered by something is not a candidate.
  const leftIds = new Set(left.map((p) => p.id));
  const outOfView = (p: PieceRow): boolean => {
    if (!ctx.view || ctx.view.length < 3) return false;
    return insideBy(ctx.view, [p.table.x, p.table.y]) < VIEW_INSET * Math.max(p.sizeMm[0], p.sizeMm[1], 1);
  };
  // With fingerprints on both sides, any piece not found at its spot may be the one (its spot may
  // look covered by a neighbour, or by another piece put down nearby); the fingerprint and the
  // clear-margin rule decide.
  const candidates = existing.filter(
    (p) => !taken.has(p.id) && (p.status === 'table' || p.status === 'pending' || p.status === 'missing' || p.status === 'aside'),
  );
  const free = (p: PieceRow) => leftIds.has(p.id) || p.status === 'missing' || p.status === 'aside' || outOfView(p);
  // Set-aside pieces can't be taken back while BATCH.asideCost < 0 (every pair with one is refused
  // below), so they aren't compared at all. Measured 2026-11-10: with 600–900 pieces set aside, the
  // first photo of a new batch (300 pieces) spent 2–3 s comparing them, freezing the screen, for
  // the very same result.
  const comparable = BATCH.asideCost < 0 ? candidates.filter((p) => p.status !== 'aside') : candidates;
  // Outline signatures (the pieces' here, the sightings' below), worked out only for those that get
  // that far (most pairs are ruled out first by size, colour or picture).
  const sigs = new Map<PieceRow, Float32Array>();
  const sigOf = (p: PieceRow): Float32Array => {
    let s = sigs.get(p);
    if (!s) sigs.set(p, (s = shapeSignature(p.outlineMm)));
    return s;
  };
  const newOnes: number[] = [];
  const matchedRows = new Map(updates.map((u) => [u.id, u]));
  /** Sightings to compare with the candidates (index into found). */
  const toMatch: number[] = [];
  for (const i of unmatched) {
    const f = found[i]!;
    // Touching pieces already known (their centres inside the blob): those pieces, still there.
    if (f.flags.clump) {
      const inside = onTable.filter((p) => !taken.has(p.id) && inPoly(f.outlineMm, p.table.x, p.table.y));
      if (inside.length) {
        for (const p of inside) {
          taken.add(p.id);
          updates.push({
            ...p,
            updatedAt: ctx.now,
            status: p.status === 'pending' ? 'pending' : 'table',
            table: { ...p.table, lastSeen: ctx.now, snapId: ctx.snapId },
            seen: p.seen + 1,
          });
        }
        continue;
      }
    }
    // A fragment of a piece already matched in this photo (a piece found in two parts).
    const fArea = Math.max(1, f.areaMm2);
    if (
      [...matchedRows.values()].some(
        (p) =>
          Math.hypot(p.table.x - f.centreMm[0], p.table.y - f.centreMm[1]) < Math.max(p.sizeMm[0], p.sizeMm[1], 1) &&
          (outlineOverlap(absoluteOutline(p), f.outlineMm) * Math.min(fArea, p.areaMm2)) / fArea >= FRAGMENT_OVERLAP,
      )
    ) {
      skipped++;
      continue;
    }
    // (All candidates, set-aside ones too, as before 2026-11-10: new pieces keep the order they are
    // added in, and with it their ids.)
    if (f.flags.clump || !candidates.length) {
      newOnes.push(i);
      continue;
    }
    toMatch.push(i);
  }
  // Every sighting × candidate that could be the same piece, with a cost (lower = more alike):
  // the printed picture when both have a fingerprint, the outline shape always.
  type Pair = { i: number; p: PieceRow; cost: number };
  const pairs: Pair[] = [];
  for (const i of toMatch) {
    const f = found[i]!;
    const fpA = f.patch?.fp;
    let sig: Float32Array | null = null;
    for (const p of comparable) {
      const areaDiff = Math.abs(p.areaMm2 - f.areaMm2) / Math.max(p.areaMm2, f.areaMm2, 1);
      const fpB = p.patch?.fp;
      let cost: number;
      // The cheap tests first: the outline comparison (72 turns × 72 angles) is done only for pairs
      // that pass them (measured 2026-11-10: most pairs don't).
      if (fpA?.length && fpB?.length) {
        if (areaDiff > MOVED_AREA_FP || deltaE(p.colour.meanLab, f.meanLab) > MOVED_DELTA_E_FP) continue;
        // A piece whose spot is free (empty in view, missing, or out of view) may differ more (a
        // corner read differently changes the straightened picture); one whose spot still looks
        // covered only when the picture agrees well.
        const limit = p.status === 'aside' ? BATCH.asideCost : free(p) ? MOVED_FP_COST_FREE : MOVED_FP_COST;
        const fpD = fingerprintDistance(fpA, fpB, f.patch?.sides, p.patch?.sides).d;
        // The outline only adds to the cost: a picture already too different decides it.
        if (fpD > limit) continue;
        sig ??= shapeSignature(relativeOutline(f.outlineMm, f.centreMm));
        cost = fpD + MOVED_SHAPE_WEIGHT * shapeDistance(sig, sigOf(p));
        if (cost > limit) continue;
      } else {
        // Without fingerprints (pieces scanned before M5 part 3): the outline alone, and only among
        // pieces that left a spot in view or are missing.
        // (Set-aside pieces need a fingerprint: there are too many of them for the outline alone.)
        if (!leftIds.has(p.id) && p.status !== 'missing') continue;
        if (areaDiff > MOVED_AREA || deltaE(p.colour.meanLab, f.meanLab) > MOVED_DELTA_E) continue;
        sig ??= shapeSignature(relativeOutline(f.outlineMm, f.centreMm));
        const shapeD = shapeDistance(sig, sigOf(p));
        if (shapeD > MOVED_SHAPE_MM) continue;
        cost = (shapeD / MOVED_SHAPE_MM) * MOVED_FP_COST;
      }
      pairs.push({ i, p, cost });
    }
  }
  // Most certain first; a pair counts only when clearly better than either side's next choice.
  pairs.sort((a, b) => a.cost - b.cost);
  // Each sighting's and each piece's pairs, in that same order, so the next choice is looked up
  // there rather than in all the pairs for every pair (that grew with the square of the pairs).
  const ofF = new Map<number, { list: Pair[]; from: number }>();
  const ofP = new Map<PieceRow, { list: Pair[]; from: number }>();
  for (const q of pairs) {
    let a = ofF.get(q.i);
    if (!a) ofF.set(q.i, (a = { list: [], from: 0 }));
    a.list.push(q);
    let b = ofP.get(q.p);
    if (!b) ofP.set(q.p, (b = { list: [], from: 0 }));
    b.list.push(q);
  }
  /**
   * The first of a side's pairs (cheapest first) with another partner than the pair being decided,
   * still free. Pieces taken and sightings done stay so: pairs passed over for that are passed over
   * for good (`from`).
   */
  const nextOf = (side: { list: Pair[]; from: number }, gone: (q: Pair) => boolean, same: (q: Pair) => boolean): Pair | undefined => {
    while (side.from < side.list.length && gone(side.list[side.from]!)) side.from++;
    for (let k = side.from; k < side.list.length; k++) {
      const q = side.list[k]!;
      if (!same(q) && !gone(q)) return q;
    }
    return undefined;
  };
  const done = new Set<number>();
  for (const pr of pairs) {
    if (done.has(pr.i) || taken.has(pr.p.id)) continue;
    const nextF = nextOf(
      ofF.get(pr.i)!,
      (q) => taken.has(q.p.id),
      (q) => q.p === pr.p,
    );
    const nextP = nextOf(
      ofP.get(pr.p)!,
      (q) => done.has(q.i),
      (q) => q.i === pr.i,
    );
    const clear = (q: { cost: number } | undefined) => !q || q.cost >= MOVED_MARGIN * pr.cost + MOVED_MARGIN_ABS;
    if (!clear(nextF) || !clear(nextP)) continue;
    done.add(pr.i);
    const f = found[pr.i]!;
    const best = pr.p;
    taken.add(best.id);
    moved++;
    if (best.status === 'aside') back++;
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
  // Unsure: a sighting that may be one of these known pieces, but not clearly one of them.
  const pendingOf = new Map<number, string[]>();
  for (const i of toMatch) {
    if (done.has(i)) continue;
    const maybe = (ofF.get(i)?.list ?? []).filter((q) => !taken.has(q.p.id) && (BATCH.asidePending || q.p.status !== 'aside')).slice(0, 3);
    if (maybe.length)
      pendingOf.set(
        i,
        maybe.map((q) => q.p.id),
      );
    newOnes.push(i);
  }

  // Pending rows seen again in this photo: settled when the evidence is clear now.
  const merged: MergePlan['merged'] = [];
  const removed: string[] = [];
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (let k = 0; k < updates.length; k++) {
    const u = updates[k]!;
    if (u.status !== 'pending' || u.table.lastSeen !== ctx.now) continue;
    // A candidate seen elsewhere in this photo is not this piece.
    const rest = (u.maybe ?? [])
      .map((id) => byId.get(id))
      .filter((c): c is PieceRow => Boolean(c && !taken.has(c.id) && c.status !== 'placed' && c.status !== 'tray'));
    if (!rest.length) {
      updates[k] = { ...u, status: 'table', maybe: null };
      continue;
    }
    const sig = shapeSignature(u.outlineMm);
    const costs = rest
      .map((c) => ({
        c,
        cost:
          u.patch?.fp && c.patch?.fp
            ? fingerprintDistance(u.patch.fp, c.patch.fp, u.patch.sides, c.patch.sides).d + MOVED_SHAPE_WEIGHT * shapeDistance(sig, shapeSignature(c.outlineMm))
            : Infinity,
      }))
      .sort((a, b) => a.cost - b.cost);
    const top = costs[0]!;
    const second = costs[1];
    const limit = leftIds.has(top.c.id) || top.c.status === 'missing' || top.c.status === 'aside' ? MOVED_FP_COST_FREE : MOVED_FP_COST;
    const isClear = top.cost <= limit && (!second || second.cost >= MOVED_MARGIN * top.cost + MOVED_MARGIN_ABS);
    if (!isClear) {
      updates[k] = { ...u, maybe: rest.map((c) => c.id) };
      continue;
    }
    // The known piece takes this sighting (the newest); the pending row goes.
    const c = top.c;
    taken.add(c.id);
    moved++;
    if (c.status === 'aside') back++;
    merged.push({ from: u.id, into: c.id });
    removed.push(u.id);
    updates[k] = {
      ...c,
      updatedAt: ctx.now,
      status: 'table',
      maybe: null,
      table: { ...u.table },
      outlineMm: u.outlineMm,
      areaMm2: u.areaMm2,
      sizeMm: u.sizeMm,
      colour: u.colour,
      flags: u.flags,
      bestPxPerMm: Math.max(u.bestPxPerMm, c.bestPxPerMm),
      thumbBlobId: u.thumbBlobId ?? c.thumbBlobId,
      patch: u.patch ?? c.patch,
      seen: c.seen + u.seen,
    };
  }
  for (const p of left) {
    if (taken.has(p.id)) continue;
    // Only a clear piece in a photo at least about as sharp as its best one: a pale piece, or a
    // blurrier photo, may simply have missed it (it then stays on the table).
    if (p.flags.weak || p.flags.clump || ctx.pxPerMm < MISSING_MIN_SHARPNESS * p.bestPxPerMm) continue;
    missing++;
    updates.push({ ...p, status: 'missing', updatedAt: ctx.now });
  }

  let pending = 0;
  for (const i of newOnes) {
    const f = found[i]!;
    const id = ctx.newId();
    const maybe = pendingOf.get(i) ?? null;
    if (maybe) pending++;
    const thumbBlobId = f.thumb ? ctx.thumbId(id) : null;
    if (f.thumb && thumbBlobId) thumbs.push({ id: thumbBlobId, blob: f.thumb });
    added.push({
      id,
      projectId: ctx.projectId,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      status: maybe ? 'pending' : 'table',
      ...(maybe ? { maybe } : {}),
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
  return { updates, added, thumbs, patches, skipped, moved, back, missing, pending, merged, removed };
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
