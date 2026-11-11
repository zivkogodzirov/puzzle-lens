/**
 * A placed puzzle for the piece card's tests (M9 part 3): a 10 × 8 puzzle with a box picture (synthetic
 * art) and pieces whose patches are cut from that art, so the photo helper places each one at its own
 * cell (as in box-placement.spec.ts). Each piece also gets a thumbnail (its cell of the art), so the card's
 * cut-out shows.
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
/** The pieces, "r<row>c<col>" (0-based): each one's own cell is its spot. */
export const PIECES = ['r1c2', 'r3c7', 'r5c4', 'r6c8', 'r2c5', 'r4c1'];
export const PROJECT = 'e2e-card';

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

/** The box picture as a JPEG (base64). */
function boxJpeg(): string {
  return fullArt().encodeSync('jpeg', 92).toString('base64');
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

/** A piece without a patch (never placed again) whose stored placement is given: several spots, for "Also possible". */
export interface ExtraPiece {
  id: string;
  /** Its spots (0-based cells), best first, with their chances. */
  top: Array<{ col: number; row: number; p: number }>;
  verdict: 'strong' | 'likely' | 'several';
}

/**
 * Seeds the puzzle and its pieces, then opens its page. `tester`: Tester mode (on by default in the app);
 * `extra`: pieces with stored placements (listed after the others).
 */
export async function seedCard(page: Page, opts: { pieces?: string[]; tester?: boolean; extra?: ExtraPiece[] } = {}): Promise<void> {
  const ids = opts.pieces ?? PIECES;
  const ps = ids.map((pid, i) => ({ id: pid, b64: patchFor(pid, i % 4), thumb: thumbPng(pid) }));
  const extra = opts.extra ?? [];
  // The placement cache, for the box picture as seeded (same key as the app makes: placeKeyOf).
  const cache = extra.length
    ? {
        key: `placement:${PROJECT}`,
        value: {
          boxKey: `${PROJECT}:box-rect|0,0;${art.width},0;${art.width},${art.height};0,${art.height}|10x8`,
          colour: null,
          open: null,
          byPiece: Object.fromEntries(
            extra.map((x) => [x.id, { ts: 1, placement: { top: x.top.map((t) => ({ ...t, rot: 0, score: 0.5, ox: 0, oy: 0 })), verdict: x.verdict } }]),
          ),
        },
      }
    : null;
  const extraRows = extra.map((x) => ({ id: x.id, thumb: thumbPng(PIECES[0]!) }));
  await gotoScreen(page, '');
  const seeded = await page.evaluate(
    async ([box, list, w, h, pid, tester, cacheRow, more]) => {
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces', 'blobs', 'settings'], 'readwrite');
        if (tester !== null) tx.objectStore('settings').put({ key: 'testerMode', value: tester });
        if (cacheRow) tx.objectStore('settings').put(cacheRow);
        more.forEach((x, k) => {
          tx.objectStore('blobs').put({ id: `${pid}:thumb-${x.id}`, ts: 1, kind: 'thumb', blob: new Blob([bytes(x.thumb)], { type: 'image/png' }) });
          tx.objectStore('pieces').put({
            id: x.id,
            projectId: pid,
            createdAt: 1,
            updatedAt: 1,
            status: 'table',
            table: { x: 300 + k * 30, y: 100, angleDeg: 0, lastSeen: 1, snapId: 's1' },
            outlineMm: [0, 0, 1, 0, 1, 1],
            areaMm2: 345,
            sizeMm: [18, 19],
            colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
            thumbBlobId: `${pid}:thumb-${x.id}`,
            seen: 1,
            bestPxPerMm: 5,
            flags: {},
          });
        });
        tx.objectStore('blobs').put({ id: `${pid}:box-rect`, ts: 1, kind: 'box', blob: new Blob([bytes(box)], { type: 'image/jpeg' }) });
        tx.objectStore('projects').put({
          id: pid,
          name: 'Card test',
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
          tx.objectStore('pieces').put({
            id: p.id,
            projectId: pid,
            createdAt: 1,
            updatedAt: 1,
            status: 'table',
            table: { x: i * 30, y: 0, angleDeg: 0, lastSeen: 1, snapId: 's1' },
            outlineMm: [0, 0, 1, 0, 1, 1],
            areaMm2: 345,
            sizeMm: [18, 19],
            colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
            thumbBlobId: `${pid}:thumb-${p.id}`,
            seen: 1,
            bestPxPerMm: 5,
            flags: {},
            patch: { blobId: `${pid}:patch-${p.id}`, flats: [false, false, false, false], sure: false, ts: 5 },
          });
        });
        tx.oncomplete = () => res();
      });
      dbh.close();
      return 'ok';
    },
    [boxJpeg(), ps, art.width, art.height, PROJECT, opts.tester ?? null, cache, extraRows] as const,
  );
  expect(seeded).toBe('ok');
  await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), PROJECT);
  // The settings are read when the app starts.
  if (opts.tester !== undefined) await page.reload();
  // Until the spots are found: buttons appear above the pieces then and move them down.
  await expect(page.getByTestId('place-summary')).toContainText(/[1-9]\d* very likely/, { timeout: 60_000 });
}

/** The piece card open and done sliding up (its buttons take taps from then on). */
export async function cardSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('spot')).toBeVisible();
  await expect.poll(() => page.getByTestId('spot').evaluate((e) => e.hasAttribute('data-opening'))).toBe(false);
}

/** A piece's row in the database (null when it isn't there). */
export async function pieceRow(page: Page, id: string): Promise<{ status: string } | null> {
  return page.evaluate(async (pid) => {
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    const row = await new Promise<{ status: string } | undefined>((res) => {
      const q = dbh.transaction('pieces').objectStore('pieces').get(pid);
      q.onsuccess = () => res(q.result as { status: string } | undefined);
    });
    dbh.close();
    return row ?? null;
  }, id);
}

/** The catalog's thumbnails, in id order. */
export const thumbs = (page: Page) => page.locator('[data-testid="catalog"] .thumb-btn');
