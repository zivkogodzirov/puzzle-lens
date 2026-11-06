/**
 * Random piece layout on the table: random positions and rotations inside the sorting area, at
 * least `gapMm` apart and clear of the marker cards, except for deliberate touching pairs (placed
 * by sliding a piece towards a partner until the outlines meet, within ~0.05 mm).
 */
import { rng } from '../helpers/images';
import { bbox, placePoly, pointInPolygon, rasterize } from './raster';

const CELL = 0.5; // occupancy grid resolution (mm)

export interface PlacedPiece {
  id: string;
  centreMm: [number, number];
  angleDeg: number;
  faceDown: boolean;
  touching: string[];
  /** Outline on the table (mm). */
  outlineMm: number[];
}

export interface LayoutInput {
  pieces: Array<{ id: string; outlineMm: number[] }>;
  originMm: [number, number];
  areaMm: [number, number];
  gapMm: number;
  touchingShare: number;
  faceDownShare: number;
  /** Polygons (table mm) to keep clear, e.g. marker cards. */
  keepOut: number[][];
  seed: number;
}

export function layoutPieces(inp: LayoutInput): PlacedPiece[] {
  const r = rng(inp.seed * 7919 + 101);
  const [ox, oy] = inp.originMm;
  const [aw, ah] = inp.areaMm;
  const gw = Math.ceil(aw / CELL);
  const gh = Math.ceil(ah / CELL);
  const occ = new Int32Array(gw * gh); // owner index + 1 of the piece itself
  const zone = new Int32Array(gw * gh); // owner index + 1 of the gap zone; −1 = several / keep-out
  const gapCells = Math.ceil(inp.gapMm / CELL);
  const disk: Array<[number, number]> = [];
  for (let dy = -gapCells; dy <= gapCells; dy++)
    for (let dx = -gapCells; dx <= gapCells; dx++) if (dx * dx + dy * dy <= (inp.gapMm / CELL) ** 2) disk.push([dx, dy]);

  const stampZone = (gx: number, gy: number, owner: number) => {
    for (const [dx, dy] of disk) {
      const x = gx + dx;
      const y = gy + dy;
      if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
      const k = y * gw + x;
      const z = zone[k]!;
      if (z === 0) zone[k] = owner;
      else if (z !== owner) zone[k] = -1;
    }
  };

  // Keep-out polygons (marker cards), with the gap around them.
  for (const poly of inp.keepOut) {
    const cells = rasterCells(poly, ox, oy, gw, gh);
    if (!cells) continue;
    for (const k of cells.list) stampZone(k % gw, (k / gw) | 0, -1);
  }

  const n = inp.pieces.length;
  const order = inp.pieces.map((_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const k = Math.floor(r() * (i + 1));
    [order[i], order[k]] = [order[k]!, order[i]!];
  }
  const nTouch = Math.min(Math.floor(n / 2), Math.round(n * inp.touchingShare));
  const nDown = Math.round(n * inp.faceDownShare);
  const faceDown = new Set<number>();
  for (let i = 0; i < nDown; i++) faceDown.add(order[(i * 7 + 3) % n]!);

  const placed = new Map<number, PlacedPiece>();
  const outlineFor = (i: number, cx: number, cy: number, ang: number) => placePoly(inp.pieces[i]!.outlineMm, cx, cy, ang, faceDown.has(i));

  const commit = (i: number, poly: number[], cx: number, cy: number, ang: number) => {
    const cells = rasterCells(poly, ox, oy, gw, gh)!;
    for (const k of cells.list) occ[k] = i + 1;
    // Gap zone: stamp the disk around boundary cells only (interior is covered by them).
    for (const k of cells.list) {
      const x = k % gw;
      const y = (k / gw) | 0;
      const edge = x === 0 || y === 0 || x === gw - 1 || y === gh - 1 || occ[k - 1] !== i + 1 || occ[k + 1] !== i + 1 || occ[k - gw] !== i + 1 || occ[k + gw] !== i + 1;
      if (edge) stampZone(x, y, i + 1);
      else {
        const z = zone[k]!;
        zone[k] = z === 0 || z === i + 1 ? i + 1 : -1;
      }
    }
    placed.set(i, { id: inp.pieces[i]!.id, centreMm: [cx, cy], angleDeg: ang, faceDown: faceDown.has(i), touching: [], outlineMm: poly });
  };

  /** 0 = free; otherwise a reason. `partner` lets the candidate sit in that piece's gap zone. */
  const check = (poly: number[], partner = 0): number => {
    const cells = rasterCells(poly, ox, oy, gw, gh);
    if (!cells || cells.clipped) return 1;
    for (const k of cells.list) {
      if (occ[k]) return 2;
      const z = zone[k]!;
      if (z !== 0 && z !== partner) return 3;
    }
    return 0;
  };

  // Touching pairs: slide the toucher towards its partner until the outlines meet.
  const tryTouch = (i: number, p: number): boolean => {
    const P = placed.get(p)!;
    for (let attempt = 0; attempt < 60; attempt++) {
      const ang = r() * 360;
      const th = r() * Math.PI * 2;
      const dx = Math.cos(th);
      const dy = Math.sin(th);
      const at = (s: number) => outlineFor(i, P.centreMm[0] + dx * s, P.centreMm[1] + dy * s, ang);
      // Coarse: first distance (from far to near) where the rasters overlap the partner.
      let sHit = -1;
      for (let s = 45; s > 0; s -= 0.25) {
        const res = check(at(s), p + 1);
        if (res === 2) {
          sHit = s;
          break;
        }
        if (res !== 0 && s < 40) break; // blocked by something else on the way in
      }
      if (sHit < 0) continue;
      // Fine: exact polygon test, bisection between "apart" and "overlapping".
      let lo = sHit + 0.25;
      let hi = sHit - 0.6;
      if (exactGap(at(lo), P.outlineMm) <= 0) {
        lo = sHit + 2;
        if (exactGap(at(lo), P.outlineMm) <= 0) continue;
      }
      if (exactGap(at(hi), P.outlineMm) > 0) continue;
      for (let it = 0; it < 18; it++) {
        const mid = (lo + hi) / 2;
        const g = exactGap(at(mid), P.outlineMm);
        if (g > 0.05) lo = mid;
        else if (g <= 0) hi = mid;
        else {
          lo = mid;
          break;
        }
      }
      const s = lo;
      const g = exactGap(at(s), P.outlineMm);
      if (!(g > 0 && g < 0.3)) continue;
      const poly = at(s);
      if (!clearOfOthers(poly, p + 1)) continue;
      commit(i, poly, P.centreMm[0] + dx * s, P.centreMm[1] + dy * s, ang);
      placed.get(i)!.touching.push(P.id);
      P.touching.push(inp.pieces[i]!.id);
      return true;
    }
    return false;
  };

  const normal = order.slice(0, n - nTouch);
  const touchers = order.slice(n - nTouch);

  /** Raster cells of piece i turned by `ang`, centred on a cell corner (so shifting by whole cells is exact). */
  const offsetsFor = (i: number, ang: number) => {
    const poly = outlineFor(i, 0, 0, ang);
    const b = bbox(poly);
    const i0 = Math.floor(b.x0 / CELL) - 1;
    const j0 = Math.floor(b.y0 / CELL) - 1;
    const w = Math.ceil(b.x1 / CELL) + 1 - i0;
    const h = Math.ceil(b.y1 / CELL) + 1 - j0;
    const m = rasterize(poly, i0 * CELL, j0 * CELL, CELL, w, h);
    const cells: Array<[number, number]> = [];
    for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) if (m[j * w + k]) cells.push([i0 + k, j0 + j]);
    // Check order: spread out, so a collision is usually found within a few look-ups.
    const step = 97;
    const ordered: Array<[number, number]> = [];
    for (let k = 0; k < cells.length; k++) ordered.push(cells[(k * step) % cells.length]!);
    return { cells: gcd(step, cells.length) === 1 ? ordered : cells, minX: i0, minY: j0, maxX: i0 + w, maxY: j0 + h };
  };
  const fits = (o: ReturnType<typeof offsetsFor>, gx: number, gy: number) => {
    if (gx + o.minX < 0 || gy + o.minY < 0 || gx + o.maxX > gw || gy + o.maxY > gh) return false;
    for (const [dx, dy] of o.cells) {
      const k = (gy + dy) * gw + gx + dx;
      if (occ[k] || zone[k]) return false;
    }
    return true;
  };

  /** Random spot first; when crowded, the first free spot of a full scan. */
  const placeAnywhere = (i: number) => {
    let ok = false;
    for (let rot = 0; rot < 10 && !ok; rot++) {
      const ang = r() * 360;
      const o = offsetsFor(i, ang);
      const tryAt = (gx: number, gy: number) => {
        if (!fits(o, gx, gy)) return false;
        const cx = ox + gx * CELL;
        const cy = oy + gy * CELL;
        commit(i, outlineFor(i, cx, cy, ang), cx, cy, ang);
        return true;
      };
      for (let attempt = 0; attempt < 40 && !ok; attempt++) ok = tryAt(Math.floor(r() * gw), Math.floor(r() * gh));
      if (ok || rot < 2) continue;
      const stepC = 3;
      const sx = Math.floor(r() * stepC);
      const sy = Math.floor(r() * stepC);
      const rowsC = Math.ceil(gh / stepC);
      const startRow = Math.floor(r() * rowsC);
      for (let rr = 0; rr < rowsC && !ok; rr++) {
        const gy = (((startRow + rr) % rowsC) * stepC + sy) % gh;
        for (let gx = sx; gx < gw && !ok; gx += stepC) ok = tryAt(gx, gy);
      }
    }
    if (!ok) throw new Error(`layout: no room for piece ${inp.pieces[i]!.id} (${n} pieces in ${aw} × ${ah} mm, gap ${inp.gapMm} mm)`);
  };

  let normalIdx = 0;
  const leftover: number[] = [];
  for (const i of normal) {
    placeAnywhere(i);
    // Early pieces get a touching partner while there is still room around them.
    const toucher = touchers[normalIdx++];
    if (toucher !== undefined && !tryTouch(toucher, i)) leftover.push(toucher);
  }
  for (const i of leftover) placeAnywhere(i);

  function clearOfOthers(poly: number[], partner: number): boolean {
    const cells = rasterCells(poly, ox, oy, gw, gh);
    if (!cells || cells.clipped) return false;
    for (const k of cells.list) {
      if (occ[k] && occ[k] !== partner) return false;
      const z = zone[k]!;
      if (z !== 0 && z !== partner) return false;
    }
    return true;
  }

  return inp.pieces.map((_, i) => placed.get(i)!);
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function rasterCells(poly: number[], ox: number, oy: number, gw: number, gh: number): { list: number[]; clipped: boolean } | null {
  const b = bbox(poly);
  const i0 = Math.floor((b.x0 - ox) / CELL) - 1;
  const j0 = Math.floor((b.y0 - oy) / CELL) - 1;
  const i1 = Math.ceil((b.x1 - ox) / CELL) + 1;
  const j1 = Math.ceil((b.y1 - oy) / CELL) + 1;
  const w = i1 - i0;
  const h = j1 - j0;
  if (w <= 0 || h <= 0) return null;
  const m = rasterize(poly, ox + i0 * CELL, oy + j0 * CELL, CELL, w, h);
  const list: number[] = [];
  let clipped = false;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if (!m[j * w + i]) continue;
      const x = i0 + i;
      const y = j0 + j;
      if (x < 0 || y < 0 || x >= gw || y >= gh) {
        clipped = true;
        continue;
      }
      list.push(y * gw + x);
    }
  return { list, clipped };
}

/** Smallest distance between two outlines (mm), or −1 if they overlap. */
export function exactGap(a: number[], b: number[]): number {
  const A = bbox(a);
  const B = bbox(b);
  if (A.x1 < B.x0 - 5 || B.x1 < A.x0 - 5 || A.y1 < B.y0 - 5 || B.y1 < A.y0 - 5) return 5;
  for (let i = 0; i < a.length; i += 2) if (pointInPolygon(b, a[i]!, a[i + 1]!)) return -1;
  for (let i = 0; i < b.length; i += 2) if (pointInPolygon(a, b[i]!, b[i + 1]!)) return -1;
  let best = Infinity;
  const nb = b.length / 2;
  for (let i = 0; i < a.length; i += 2) {
    const px = a[i]!;
    const py = a[i + 1]!;
    if (px < B.x0 - best || px > B.x1 + best || py < B.y0 - best || py > B.y1 + best) continue;
    for (let j = 0; j < nb; j++) {
      const k = (j + 1) % nb;
      const d = segDist(px, py, b[2 * j]!, b[2 * j + 1]!, b[2 * k]!, b[2 * k + 1]!);
      if (d < best) best = d;
    }
  }
  return best;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
