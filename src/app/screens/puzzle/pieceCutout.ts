/**
 * The piece cut out of its thumbnail (M9 part 6, design plan §3.5 "Piece tile"): the piece's stored outline
 * (table mm, around its centre) drawn back into the photo it came from, so the tile shows just the piece, not the
 * table around it.
 *
 * A thumbnail is the photo cut to the piece's box with 12 % to spare on each side, at most 160 px
 * (src/workers/reader.worker.ts `thumbsAndPreview`). Its photo isn't stored with the piece, but the photo's table
 * mapping is (the snap): the outline goes through the inverse of that mapping, its box is padded the same way, and
 * the outline in that box is the clip. Only the turn of the photo matters (the box is found again from the
 * outline), so any photo of the piece with the same turn gives the same cut-out. A piece's last photo
 * (`table.snapId`) may not be the one its outline and thumbnail came from (a blurrier photo updates where it is
 * but keeps its outline), so the cut-out is used only when every photo that saw the piece is turned the same way,
 * or else when the photos as sharp as the piece's best (the one its outline came from) agree. Otherwise, and when
 * the thumbnail turns out not to have the box's shape (checked once it loads), the tile shows the thumbnail as
 * before.
 */
import { useEffect, useState } from 'preact/hooks';
import { applyH, invertH } from '../../../geo/homography';
import { db } from '../../../db/db';
import { logWarn } from '../../../log/logger';
import type { Mat3, PieceRow, SnapRow, Vec2 } from '../../../project/types';

/** The share of the tile the piece's longer side takes. */
export const CUT_SHARE = 0.72;
/** As the reader pads a thumbnail's box (reader.worker.ts). */
const THUMB_PAD = 0.12;
/**
 * Photos turned within this of each other count as the same turn. Tight on purpose: the outline (and thumbnail) may
 * come from an earlier photo than `table.snapId` (the catalog keeps the older outline unless the new photo is much
 * sharper), and drawing it into a photo turned even 8° away clips the wrong part of the thumbnail; a re-scan turned
 * more than this falls back to the sharpness rule, and then to the plain thumbnail. The real fix (a follow-up) is to
 * store the id of the photo the outline came from with the piece.
 */
const SAME_TURN = (2 * Math.PI) / 180;
/** A photo this close to the piece's best sharpness may be the one its outline came from. */
const SAME_SHARPNESS = 0.04;
/** Corners of the clip, at most (the outline is thinned evenly; plenty for a 60–70 px piece). */
const MAX_POINTS = 64;
/** A loaded thumbnail's width ÷ height may differ from the box's by this much (rounding, a 1-px box edge). */
export const ASPECT_SLACK = 0.08;

/** One photo's mapping, as the cut-out needs it. */
export interface PhotoFrame {
  /** Table mm → photo px. */
  toImg: Mat3;
  width: number;
  height: number;
  /** Photo px per mm at its centre. */
  ppm: number;
  /** Which way the photo's x axis points on the table (radians), and whether the photo is mirrored. */
  turn: number;
  flip: boolean;
}

/** The project's photos (by snap id), and which photos saw each piece. */
export interface PhotoFrames {
  frames: Map<string, PhotoFrame>;
  sightings: Map<string, string[]>;
}

export const NO_FRAMES: PhotoFrames = { frames: new Map(), sightings: new Map() };

export function photoFrame(s: Pick<SnapRow, 'imgToTable' | 'width' | 'height'>): PhotoFrame | null {
  if (!s.imgToTable || !(s.width > 0) || !(s.height > 0)) return null;
  const toImg = invertH(s.imgToTable);
  if (!toImg) return null;
  const c: Vec2 = [(s.width - 1) / 2, (s.height - 1) / 2];
  const a = applyH(s.imgToTable, c);
  const b = applyH(s.imgToTable, [c[0] + 100, c[1]]);
  const d = applyH(s.imgToTable, [c[0], c[1] + 100]);
  const ux = [b[0] - a[0], b[1] - a[1]];
  const uy = [d[0] - a[0], d[1] - a[1]];
  const len = Math.hypot(ux[0]!, ux[1]!);
  if (!Number.isFinite(len) || len <= 0) return null;
  return { toImg, width: s.width, height: s.height, ppm: 100 / len, turn: Math.atan2(ux[1]!, ux[0]!), flip: ux[0]! * uy[1]! - ux[1]! * uy[0]! < 0 };
}

export function photoFrames(snaps: SnapRow[]): PhotoFrames {
  const frames = new Map<string, PhotoFrame>();
  const sightings = new Map<string, string[]>();
  for (const s of snaps) {
    const f = photoFrame(s);
    if (!f) continue;
    frames.set(s.id, f);
    for (const id of s.pieceIds ?? []) {
      const list = sightings.get(id);
      if (list) list.push(s.id);
      else sightings.set(id, [s.id]);
    }
  }
  return { frames, sightings };
}

function sameTurn(fs: PhotoFrame[]): boolean {
  const f0 = fs[0]!;
  return fs.every((f) => {
    const d = Math.abs(((f.turn - f0.turn + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    return f.flip === f0.flip && d <= SAME_TURN;
  });
}

/** The photo to draw the piece's outline into, or null when it can't be told. */
export function frameFor(p: PieceRow, { frames, sightings }: PhotoFrames): PhotoFrame | null {
  const ids = [p.table.snapId, ...(sightings.get(p.id) ?? [])];
  const seen = [...new Set(ids)].map((id) => frames.get(id)).filter((f): f is PhotoFrame => Boolean(f));
  if (!seen.length) return null;
  if (sameTurn(seen)) return frames.get(p.table.snapId) ?? seen[0]!;
  const sharp = seen.filter((f) => p.bestPxPerMm > 0 && Math.abs(f.ppm / p.bestPxPerMm - 1) <= SAME_SHARPNESS);
  return sharp.length && sameTurn(sharp) ? sharp[0]! : null;
}

/** How to draw the thumbnail in its tile so the piece sits in the middle, and the clip around the piece. */
export interface Cutout {
  /** The thumbnail's place in the tile (per cent of the tile). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** CSS clip-path: the outline as a polygon in per cent of the thumbnail. */
  clip: string;
  /** The thumbnail's expected width ÷ height. */
  aspect: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The cut-out for a piece in this photo (null: no usable outline). */
export function cutoutIn(p: PieceRow, f: PhotoFrame): Cutout | null {
  const o = p.outlineMm;
  const n = Math.floor(o.length / 2);
  if (n < 3) return null;
  // The homography written out (no arrays per point: a grid works out 200 of these at once).
  const [a, b, c, d, e, g, h0, h1, h2] = f.toImg as [number, number, number, number, number, number, number, number, number];
  const pts = new Float64Array(2 * n);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const tx = p.table.x + o[2 * i]!;
    const ty = p.table.y + o[2 * i + 1]!;
    const z = h0 * tx + h1 * ty + h2;
    const x = (a * tx + b * ty + c) / z;
    const y = (d * tx + e * ty + g) / z;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts[2 * i] = x;
    pts[2 * i + 1] = y;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const w = x1 - x0;
  const h = y1 - y0;
  if (!(w > 1) || !(h > 1)) return null;
  // The thumbnail's box, as the reader cut it.
  const pad = Math.round(Math.max(w, h) * THUMB_PAD);
  const sx = Math.max(0, x0 - pad);
  const sy = Math.max(0, y0 - pad);
  const sw = Math.min(f.width - sx, w + 2 * pad);
  const sh = Math.min(f.height - sy, h + 2 * pad);
  if (!(sw > 1) || !(sh > 1)) return null;
  // The piece's longer side takes CUT_SHARE of the tile, centred.
  const k = CUT_SHARE / Math.max(w, h);
  const step = Math.max(1, Math.ceil(n / MAX_POINTS));
  const poly: string[] = [];
  for (let i = 0; i < n; i += step) poly.push(`${r1(((pts[2 * i]! - sx) / sw) * 100)}% ${r1(((pts[2 * i + 1]! - sy) / sh) * 100)}%`);
  return {
    left: r1((0.5 - (x0 - sx + w / 2) * k) * 100),
    top: r1((0.5 - (y0 - sy + h / 2) * k) * 100),
    width: r1(sw * k * 100),
    height: r1(sh * k * 100),
    clip: `polygon(${poly.join(', ')})`,
    aspect: sw / sh,
  };
}

/** The thumbnail loaded has the shape the cut-out expects. */
export function fitsThumb(c: Cutout, naturalWidth: number, naturalHeight: number): boolean {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return false;
  return Math.abs(naturalWidth / naturalHeight / c.aspect - 1) <= ASPECT_SLACK;
}

const cutCache = new WeakMap<PieceRow, { frames: PhotoFrames; cut: Cutout | null }>();

/** The piece's cut-out (kept per piece row and photo set: a grid of 1000 is worked out once). */
export function cutoutOf(p: PieceRow, frames: PhotoFrames): Cutout | null {
  const hit = cutCache.get(p);
  if (hit && hit.frames === frames) return hit.cut;
  const f = frameFor(p, frames);
  const cut = f ? cutoutIn(p, f) : null;
  cutCache.set(p, { frames, cut });
  return cut;
}

/** Per project: the photos read last time, and which pieces' photos they were read for. */
const framesCache = new Map<string, { key: string; frames: PhotoFrames }>();

/**
 * The project's photo mappings, read from the database once per set of photos the pieces were last seen in
 * (a new scan adds one, and they are read again); kept between tab visits.
 */
export function usePhotoFrames(projectId: string | null, rows: PieceRow[]): PhotoFrames {
  const key = projectId ? `${projectId}|${[...new Set(rows.map((r) => r.table.snapId))].sort().join(',')}` : '';
  const kept = projectId ? framesCache.get(projectId) : undefined;
  const [frames, setFrames] = useState<PhotoFrames>(kept?.frames ?? NO_FRAMES);
  useEffect(() => {
    if (!projectId) return;
    const have = framesCache.get(projectId);
    if (have?.key === key) {
      setFrames(have.frames);
      return;
    }
    let live = true;
    db()
      .snaps.where('projectId')
      .equals(projectId)
      .toArray()
      .then((snaps) => {
        const next = photoFrames(snaps);
        framesCache.set(projectId, { key, frames: next });
        if (live) setFrames(next);
      })
      .catch((err) => logWarn('puzzle', 'The photos of the pieces could not be read', err));
    return () => {
      live = false;
    };
  }, [projectId, key]);
  return frames;
}
