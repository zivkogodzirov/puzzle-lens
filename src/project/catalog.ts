/**
 * The catalog (PLAN §6 M2): pieces found in a scan photo are merged into the puzzle's pieces.
 * A piece found again at the same table position (same size) is the same piece — it is updated,
 * never added twice. Re-identification after pieces are MOVED comes in M5 (fingerprints).
 */
import type { PieceFlags, PieceRow, Vec2 } from './types';

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
}

export interface MergePlan {
  /** Existing pieces to update (same id). */
  updates: PieceRow[];
  /** New pieces. */
  added: PieceRow[];
  /** Thumbnails to store: blob id → JPEG. */
  thumbs: Array<{ id: string; blob: Blob }>;
  /** Found pieces left out (cut by the photo edge and not known yet). */
  skipped: number;
}

/** Two sightings are the same piece when their centres are this close (share of the piece's size)… */
export const SAME_PIECE_DIST = 0.35;
/** …and their areas differ by less than this share. */
export const SAME_PIECE_AREA = 0.3;

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
  ctx: { projectId: string; snapId: string; pxPerMm: number; now: number; newId: () => string; thumbId: (pieceId: string) => string },
): MergePlan {
  const onTable = existing.filter((p) => p.status === 'table' || p.status === 'pending');
  const taken = new Set<string>();
  const updates: PieceRow[] = [];
  const added: PieceRow[] = [];
  const thumbs: MergePlan['thumbs'] = [];
  let skipped = 0;
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
      const sharper = ctx.pxPerMm > best.bestPxPerMm * 1.15 && !f.flags.cut && !f.flags.clump;
      const next: PieceRow = {
        ...best,
        updatedAt: ctx.now,
        table: { x: f.flags.cut ? best.table.x : f.centreMm[0], y: f.flags.cut ? best.table.y : f.centreMm[1], angleDeg: sharper ? f.angleDeg : best.table.angleDeg, lastSeen: ctx.now, snapId: ctx.snapId },
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
      }
      updates.push(next);
      continue;
    }
    if (f.flags.cut) {
      skipped++;
      continue;
    }
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
    });
  }
  return { updates, added, thumbs, skipped };
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
