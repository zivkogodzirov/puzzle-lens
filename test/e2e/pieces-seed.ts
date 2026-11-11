/**
 * A puzzle for the Pieces tab's tests (M9 part 4): a 10 × 8 puzzle with a box picture (synthetic art) and pieces
 * whose patches are cut from that art (so each is placed at its own cell, as in place-seed.ts), with their real
 * outlines (so they read as corner, edge or inside) and a thumbnail each. Optionally pieces to check (a rescan's),
 * faint ones, and a bulk of extra pieces without a patch (for the 1000-piece grid).
 */
import { createCanvas } from '@napi-rs/canvas';
import type { Page } from '@playwright/test';
import { extractPatch } from '../../src/cv/placement';
import type { Vec2 } from '../../src/project/types';
import { generatePuzzle } from '../synth/index';
import { expect, gotoScreen } from './fixtures';

export const pz = generatePuzzle({ cols: 10, rows: 8, cellMm: [17.8, 19.4], seed: 5 });
const art = pz.art;
const picture = { data: art.rgba, width: art.width, height: art.height, stride: art.width * 4 };
export const PROJECT = 'e2e-pieces';

/**
 * The default pieces, "r<row>c<col>" (0-based): a square of 4 (columns 4–5, rows 3–4), a pair (columns 7–8, row 6),
 * a corner, three edges and two more inside pieces.
 */
export const PIECES = ['r2c3', 'r2c4', 'r3c3', 'r3c4', 'r5c6', 'r5c7', 'r0c0', 'r0c5', 'r4c0', 'r7c3', 'r1c6', 'r4c8'];

function patchFor(id: string, q: number): string {
  const p = pz.pieces.find((x) => x.id === id)!;
  const [sx, sy] = art.pxPerMm;
  const cx = (p.col + 0.5) * pz.cellMm[0];
  const cy = (p.row + 0.5) * pz.cellMm[1];
  const toPx = (x: number, y: number): Vec2 => [(x + cx) * sx, (y + cy) * sy];
  const corners = [0, 1, 2, 3].map((k) => toPx(p.cornersMm[2 * k]!, p.cornersMm[2 * k + 1]!));
  const outline: number[] = [];
  for (let i = 0; i < p.outlineMm.length; i += 2) outline.push(...toPx(p.outlineMm[i]!, p.outlineMm[i + 1]!));
  const patch = extractPatch(
    picture,
    [0, 1, 2, 3].map((k) => corners[(k + q) % 4]!),
    outline,
  )!;
  return Buffer.from(patch.rgba).toString('base64');
}

function fullArt() {
  const c = createCanvas(art.width, art.height);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(art.width, art.height);
  id.data.set(art.rgba);
  ctx.putImageData(id, 0, 0);
  return c;
}

/** A piece's thumbnail: its cell of the art with a little margin, as a PNG (base64). */
function thumbPng(id: string): string {
  const p = pz.pieces.find((x) => x.id === id)!;
  const cw = art.width / 10;
  const ch = art.height / 8;
  const c = createCanvas(120, 120);
  const ctx = c.getContext('2d');
  ctx.drawImage(fullArt(), (p.col - 0.2) * cw, (p.row - 0.2) * ch, cw * 1.4, ch * 1.4, 0, 0, 120, 120);
  return c.encodeSync('png').toString('base64');
}

/** A piece's place on the table (mm) when the art is the photo (`cut`): its cell's centre. */
function artCentreMm(id: string): Vec2 {
  const p = pz.pieces.find((x) => x.id === id)!;
  return [(p.col + 0.5) * pz.cellMm[0], (p.row + 0.5) * pz.cellMm[1]];
}

/**
 * M9 part 6: a piece's thumbnail cut as the reader cuts one (reader.worker.ts `thumbsAndPreview`): the box of its
 * outline in the art (the "photo", art px = table mm × art.pxPerMm) with 12 % to spare, at most 160 px, as a PNG.
 */
function readerThumbPng(id: string): string {
  const p = pz.pieces.find((x) => x.id === id)!;
  const [sx, sy] = art.pxPerMm;
  const [cx, cy] = artCentreMm(id);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < p.outlineMm.length; i += 2) {
    const x = (cx + p.outlineMm[i]!) * sx;
    const y = (cy + p.outlineMm[i + 1]!) * sy;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const w = x1 - x0;
  const h = y1 - y0;
  const pad = Math.round(Math.max(w, h) * 0.12);
  const bx = Math.max(0, x0 - pad);
  const by = Math.max(0, y0 - pad);
  const bw = Math.min(art.width - bx, w + 2 * pad);
  const bh = Math.min(art.height - by, h + 2 * pad);
  const s = Math.min(1, 160 / Math.max(bw, bh));
  const c = createCanvas(Math.max(1, Math.round(bw * s)), Math.max(1, Math.round(bh * s)));
  c.getContext('2d').drawImage(fullArt(), bx, by, bw, bh, 0, 0, c.width, c.height);
  return c.encodeSync('png').toString('base64');
}

export interface PiecesSeed {
  /**
   * M9 part 6: the art is the photo the pieces were read from (a snap mapping art px to table mm, each piece at its
   * cell and its thumbnail cut as the reader cuts one), so the tiles show the pieces cut out by their outlines.
   */
  cut?: boolean;
  pieces?: string[];
  /** Pieces a rescan saw where no known piece was (status 'pending'), each maybe one of `maybe`. */
  pending?: Array<{ id: string; like: string; maybe: string[] }>;
  /** Pieces with a faint outline (flags.weak). */
  weak?: string[];
  /** Pieces touching another piece (flags.clump). */
  clump?: string[];
  /** Extra pieces on the table without a patch (not placed), with the outlines and thumbnails of the art's cells in turn. */
  bulk?: number;
  /** The tab to open (default: Pieces); null: stay on Home. */
  open?: 'pieces' | null;
}

/** Seeds the puzzle and opens its Pieces tab once the spots are found. */
export async function seedPieces(page: Page, opts: PiecesSeed = {}): Promise<void> {
  const ids = opts.pieces ?? PIECES;
  const weak = new Set(opts.weak ?? []);
  const clump = new Set(opts.clump ?? []);
  const cut = Boolean(opts.cut);
  const thumbOf = cut ? readerThumbPng : thumbPng;
  const at = (id: string) => (cut ? artCentreMm(id) : null);
  const ps = ids.map((pid, i) => ({
    id: pid,
    b64: patchFor(pid, i % 4),
    thumb: thumbOf(pid),
    outline: pz.pieces.find((x) => x.id === pid)!.outlineMm,
    weak: weak.has(pid),
    clump: clump.has(pid),
    at: at(pid),
  }));
  const pend = (opts.pending ?? []).map((x) => ({ ...x, thumb: thumbOf(x.like), outline: pz.pieces.find((q) => q.id === x.like)!.outlineMm, at: at(x.like) }));
  // The bulk: the art's 80 cells in turn (their thumbnails stored once each).
  const cells = pz.pieces.map((p) => ({ id: p.id, thumb: opts.bulk ? thumbOf(p.id) : '', outline: p.outlineMm, at: at(p.id) }));
  const box = fullArt().encodeSync('jpeg', 92).toString('base64');
  // The photo: art px → table mm.
  const snap = cut ? { width: art.width, height: art.height, imgToTable: [1 / art.pxPerMm[0], 0, 0, 0, 1 / art.pxPerMm[1], 0, 0, 0, 1] } : null;
  await gotoScreen(page, '');
  const seeded = await page.evaluate(
    async ([boxB64, list, pending, w, h, pid, bulk, bulkCells, photo]) => {
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const row = (id: string, i: number, outline: number[], thumb: string, extra: object, at: number[] | null = null) => ({
        id,
        projectId: pid,
        createdAt: 1,
        updatedAt: 1,
        status: 'table',
        table: { x: at ? at[0]! : (i % 40) * 30, y: at ? at[1]! : Math.floor(i / 40) * 30, angleDeg: 0, lastSeen: 1, snapId: 's1' },
        outlineMm: outline,
        areaMm2: 345,
        sizeMm: [18, 19],
        colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
        thumbBlobId: thumb,
        seen: 1,
        bestPxPerMm: 5,
        flags: {},
        ...extra,
      });
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces', 'blobs', 'snaps'], 'readwrite');
        if (photo)
          tx.objectStore('snaps').put({ id: 's1', projectId: pid, kind: 'overview', ts: 1, zoom: 1, quality: null, blobId: null, pieceIds: [], ...photo });
        tx.objectStore('blobs').put({ id: `${pid}:box-rect`, ts: 1, kind: 'box', blob: new Blob([bytes(boxB64)], { type: 'image/jpeg' }) });
        tx.objectStore('projects').put({
          id: pid,
          name: 'Harbour at dusk',
          createdAt: 1,
          updatedAt: 2,
          pieceCount: 80,
          grid: { cols: 10, rows: 8, source: 'suggested' },
          box: {
            photoBlobId: `${pid}:box-rect`,
            rectifiedBlobId: `${pid}:box-rect`,
            corners: [
              [0, 0],
              [w, 0],
              [w, h],
              [0, h],
            ],
            photoWidth: w,
            photoHeight: h,
            width: w,
            height: h,
          },
          markerMap: null,
          tableModel: null,
          piecePitch: { wMm: 17.8, hMm: 19.4, n: 6 },
          setupStep: 6,
          tracking: 'pieces',
          scaleSource: 'coin',
          openSpots: null,
        });
        list.forEach((p, i) => {
          tx.objectStore('blobs').put({ id: `${pid}:patch-${p.id}`, ts: 1, kind: 'patch', blob: new Blob([bytes(p.b64)]) });
          tx.objectStore('blobs').put({ id: `${pid}:thumb-${p.id}`, ts: 1, kind: 'thumb', blob: new Blob([bytes(p.thumb)], { type: 'image/png' }) });
          tx.objectStore('pieces').put(
            row(
              p.id,
              i,
              p.outline,
              `${pid}:thumb-${p.id}`,
              {
                flags: { ...(p.weak ? { weak: true } : {}), ...(p.clump ? { clump: true } : {}) },
                patch: { blobId: `${pid}:patch-${p.id}`, flats: [false, false, false, false], sure: false, ts: 5 },
              },
              p.at,
            ),
          );
        });
        pending.forEach((p, k) => {
          tx.objectStore('blobs').put({ id: `${pid}:thumb-${p.id}`, ts: 1, kind: 'thumb', blob: new Blob([bytes(p.thumb)], { type: 'image/png' }) });
          tx.objectStore('pieces').put(row(p.id, 100 + k, p.outline, `${pid}:thumb-${p.id}`, { status: 'pending', maybe: p.maybe, patch: null }, p.at));
        });
        if (bulk)
          bulkCells.forEach((c) =>
            tx.objectStore('blobs').put({ id: `${pid}:cell-${c.id}`, ts: 1, kind: 'thumb', blob: new Blob([bytes(c.thumb)], { type: 'image/png' }) }),
          );
        for (let i = 0; i < bulk; i++) {
          const c = bulkCells[i % bulkCells.length]!;
          tx.objectStore('pieces').put(row(`bulk-${String(i).padStart(4, '0')}`, 200 + i, c.outline, `${pid}:cell-${c.id}`, { patch: null }, c.at));
        }
        tx.oncomplete = () => res();
      });
      dbh.close();
      return 'ok';
    },
    [box, ps, pend, art.width, art.height, PROJECT, opts.bulk ?? 0, cells, snap] as const,
  );
  expect(seeded).toBe('ok');
  if (opts.open === null) return;
  await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}/pieces`), PROJECT);
  await expect(page.getByTestId('place-summary')).toContainText(/[1-9]\d* very likely/, { timeout: 60_000 });
}
