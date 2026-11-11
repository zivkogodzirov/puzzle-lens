/**
 * Hand-counted pieces on the owner's real photos (M10 part 1): every piece-finding change is
 * measured against these counts, not guessed. The photos are in test/fixtures/real (kept out of git;
 * skipped when missing, as on GitHub); the labels, numbers only, in test/fixtures/real-labels/
 * (format in each file's `_about`): every loose piece's centre, counted by eye on 1:1 crops, and
 * the built puzzle's outline.
 *
 * Each photo goes through the app's own scan, as Scan's first photo of a project runs it in the
 * reader worker (scanFreePixels: no catalog, no scale hint, 1×, overview, the 1000-piece box and its
 * 28 × 36 grid), and the outlines it reports (for a finished puzzle, those the loose pieces are
 * counted from) are matched to the labels one to one: an outline not flagged clump or cut whose
 * centre is within half a piece pitch of a label that lies inside it, nearest first. Then per photo:
 * - one by one: a labelled piece matched that way (outlined on its own, correctly);
 * - in clump: not matched, but in an outline flagged clump (inside it or within a quarter pitch of
 *   it): found, not outlined on its own;
 * - missed: neither (also when it is merged into another piece's outline without the clump flag, or
 *   only part of it is outlined);
 * - false: an outline (not cut) on no labelled piece at all, off / on the built picture.
 * Recall = one by one / pieces, found = (one by one + in clump) / pieces, precision = outlines on
 * a piece / (those + false ones); cut outlines and those only on doubtful pieces are left out.
 *
 * The floors are main's numbers on 2026-11-11 (no regression); the bar is 98 % (PLAN, Known issues).
 * A change that moves a number on purpose updates FLOOR here with the reason in its report.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanFreePixels } from '../../src/cv/scanFreePixels';
import type { FoundPiece } from '../../src/cv/pieceFinder';
import { getCv } from '../helpers/cv';
import { resizeBuffer } from '../helpers/images';
import { decodeRgba, REAL_DIR } from '../helpers/realFixtures';

const LABEL_DIR = fileURLToPath(new URL('../fixtures/real-labels/', import.meta.url));

interface LabelFile {
  photo: string;
  size: [number, number];
  sidePx: number;
  picture: number[][];
  holes: number[][];
  ignore: number[][];
  pieces: Array<{ x: number; y: number; tag: string; unsure?: boolean }>;
}

const labels: LabelFile[] = readdirSync(LABEL_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(LABEL_DIR + f, 'utf8')) as LabelFile)
  .filter((l) => existsSync(`${REAL_DIR}${l.photo}.jpeg`));

/**
 * Main's numbers on 2026-11-11: one by one at least, found (one by one + in clump) at least, false at most.
 * M10 split (touching pieces split, single pieces un-flagged, false pieces on the built picture dropped):
 * one by one and false updated to the new numbers. Found is 1 lower on three photos, each looked at on a crop:
 * IMG_9127 a pale piece mostly outside the touching outline it was counted in (the outline is now cut into
 * the 3 pieces it holds, and none of them covers it); IMG_9244 a loose piece lying on the built picture whose
 * outline was a pale part of it (dropped with the false pieces there; that photo is a finished puzzle, so
 * nothing on its picture is catalogued anyway); IMG_9246 a piece whose traced outline bites into its middle
 * (as on main): it is now a single piece, and its label falls in the bite.
 * Review fixes (2026-11-11): one by one 14 → 13 on IMG_9245 and 41 → 39 on IMG_9246, on purpose: those "pieces" were parts of
 * wrong splits (IMG_9245: one piece cut in two, its label in one half; IMG_9246: two pieces cut in three, two parts holding a
 * label each), now left as one touching outline (found, in clump). Each part of every split on the 11 photos was checked
 * against the labels: every part left holds exactly one piece centre.
 */
const FLOOR: Record<string, { single: number; found: number; falseMax: number }> = {
  IMG_9127: { single: 49, found: 56, falseMax: 0 },
  IMG_9224: { single: 59, found: 68, falseMax: 4 },
  IMG_9244: { single: 20, found: 32, falseMax: 5 },
  IMG_9245: { single: 13, found: 17, falseMax: 0 },
  IMG_9246: { single: 39, found: 53, falseMax: 1 },
  IMG_9263: { single: 24, found: 24, falseMax: 0 },
  IMG_9264: { single: 26, found: 26, falseMax: 0 },
  IMG_9274: { single: 20, found: 21, falseMax: 1 },
  IMG_9276: { single: 21, found: 21, falseMax: 1 },
  IMG_9280: { single: 8, found: 8, falseMax: 10 },
  IMG_9281: { single: 18, found: 18, falseMax: 0 },
};

interface Counts {
  pieces: number;
  single: number;
  clump: number;
  missed: number;
  falseOff: number;
  falseOn: number;
  /** Outlines counted for precision (not cut, not ignored, not only on doubtful pieces). */
  outlines: number;
  /** Of those, the ones on a real piece (matched one by one, or a clump holding one). */
  onPiece: number;
}

function inside(poly: number[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, n = poly.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = poly[i]!;
    const yi = poly[i + 1]!;
    const xj = poly[j]!;
    const yj = poly[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function edgeDistance(poly: number[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, n = poly.length, j = n - 2; i < n; j = i, i += 2) {
    const ax = poly[j]!;
    const ay = poly[j + 1]!;
    const dx = poly[i]! - ax;
    const dy = poly[i + 1]! - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

function centroid(o: number[]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = o.length; i < n; i += 2) {
    const j = (i + 2) % n;
    const cr = o[i]! * o[j + 1]! - o[j]! * o[i + 1]!;
    a += cr;
    cx += (o[i]! + o[j]!) * cr;
    cy += (o[i + 1]! + o[j + 1]!) * cr;
  }
  if (Math.abs(a) < 1e-9) return [o[0]!, o[1]!];
  return [cx / (3 * a), cy / (3 * a)];
}

/** Matches the outlines to the labels and counts (see the header). */
function countAgainst(L: LabelFile, found: Array<Pick<FoundPiece, 'outlineImg' | 'flags'>>): Counts {
  const scored = (p: LabelFile['pieces'][number]) => !p.unsure && p.tag !== 'cut-by-edge';
  const outs = found
    .filter((p) => p.outlineImg.length >= 6)
    .map((p) => ({ o: p.outlineImg, f: p.flags, c: centroid(p.outlineImg) }))
    .filter((p) => !L.ignore.some((g) => inside(g, p.c[0], p.c[1])));
  // One to one, nearest first: an outline (not clump, not cut) and a label within half a pitch, inside it.
  const pairs: Array<{ d: number; i: number; j: number }> = [];
  outs.forEach((p, i) => {
    if (p.f.clump || p.f.cut) return;
    L.pieces.forEach((l, j) => {
      const d = Math.hypot(p.c[0] - l.x, p.c[1] - l.y);
      if (d <= 0.5 * L.sidePx && inside(p.o, l.x, l.y)) pairs.push({ d, i, j });
    });
  });
  pairs.sort((a, b) => a.d - b.d);
  // Nearest pairs first, each outline and each label used once.
  const outTaken = new Set<number>();
  const labTaken = new Set<number>();
  for (const { i, j } of pairs) {
    if (outTaken.has(i) || labTaken.has(j)) continue;
    outTaken.add(i);
    labTaken.add(j);
  }
  // In a clump, or on a piece at all: inside the outline, or within a quarter pitch of it (a clump's
  // traced outline can leave out a pale piece's centre, IMG_9127).
  const covers = (o: number[], l: { x: number; y: number }) => inside(o, l.x, l.y) || edgeDistance(o, l.x, l.y) <= 0.25 * L.sidePx;
  const r: Counts = { pieces: 0, single: 0, clump: 0, missed: 0, falseOff: 0, falseOn: 0, outlines: 0, onPiece: 0 };
  L.pieces.forEach((l, j) => {
    if (!scored(l)) return;
    r.pieces++;
    if (labTaken.has(j)) r.single++;
    else if (outs.some((p) => p.f.clump && !p.f.cut && covers(p.o, l))) r.clump++;
    else {
      r.missed++;
      missedByTag[l.tag] = (missedByTag[l.tag] ?? 0) + 1;
    }
  });
  outs.forEach((p) => {
    if (p.f.cut) return;
    const held = L.pieces.filter((l) => covers(p.o, l));
    if (held.some(scored)) {
      r.outlines++;
      r.onPiece++;
      return;
    }
    // On a doubtful or cut-by-edge piece only: neither right nor false.
    if (held.length) return;
    r.outlines++;
    const onPicture = L.picture.some((g) => inside(g, p.c[0], p.c[1])) && !L.holes.some((g) => inside(g, p.c[0], p.c[1]));
    if (onPicture) r.falseOn++;
    else r.falseOff++;
  });
  return r;
}

/** Missed pieces by their label's tag, all photos together (where the misses are). */
const missedByTag: Record<string, number> = {};

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '-');

describe.skipIf(labels.length === 0)('real photos, hand-counted pieces (scan as the first photo of a project)', () => {
  it('pieces outlined one by one, in clumps, missed, false; no fewer than on main', async () => {
    const cv = await getCv();
    const rows: string[] = [];
    const total: Counts = { pieces: 0, single: 0, clump: 0, missed: 0, falseOff: 0, falseOn: 0, outlines: 0, onPiece: 0 };
    const got: Record<string, Counts> = {};
    for (const L of labels) {
      let img = await decodeRgba(`${REAL_DIR}${L.photo}.jpeg`);
      const s = 4032 / Math.max(img.width, img.height);
      if (s < 1) img = resizeBuffer(cv, img, 4, Math.round(img.width * s), Math.round(img.height * s), cv.INTER_AREA);
      expect([img.width, img.height]).toEqual(L.size);
      const t0 = performance.now();
      const { r, looseFound } = scanFreePixels(cv, img, {
        catalog: [],
        pitchMm: 18.6,
        zoom: 1,
        kind: 'overview',
        table: null,
        pieceCount: 1000,
        grid: { cols: 28, rows: 36 },
      });
      const ms = performance.now() - t0;
      // The outlines the app shows, or for a finished puzzle the ones it counts the loose pieces from.
      const found = looseFound ?? (r.registered ? r.pieces : (r.unplaced ?? []));
      const c = countAgainst(L, found);
      got[L.photo] = c;
      for (const k of Object.keys(total) as Array<keyof Counts>) total[k] += c[k];
      rows.push(row(L.photo, c, `${(ms / 1000).toFixed(1)} s`));
    }
    rows.push(row('all', total, ''));
    console.log(
      [
        'photo     pieces  one-by-one  in-clump  missed  false-off  false-on  recall  found  precision  time',
        ...rows,
        `missed by tag: ${Object.entries(missedByTag)
          .sort((a, b) => b[1] - a[1])
          .map(([t, n]) => `${t} ${n}`)
          .join(', ')}`,
        `FLOOR: ${JSON.stringify(Object.fromEntries(Object.entries(got).map(([k, c]) => [k, { single: c.single, found: c.single + c.clump, falseMax: c.falseOff + c.falseOn }])))}`,
      ].join('\n'),
    );
    for (const [photo, c] of Object.entries(got)) {
      const f = FLOOR[photo];
      if (!f) continue;
      expect(c.single, `${photo}: pieces outlined one by one`).toBeGreaterThanOrEqual(f.single);
      expect(c.single + c.clump, `${photo}: pieces found (one by one or in a clump)`).toBeGreaterThanOrEqual(f.found);
      expect(c.falseOff + c.falseOn, `${photo}: false pieces`).toBeLessThanOrEqual(f.falseMax);
    }
  }, 180_000);
});

function row(name: string, c: Counts, time: string): string {
  const cols = [
    name.padEnd(9),
    String(c.pieces).padStart(6),
    String(c.single).padStart(11),
    String(c.clump).padStart(9),
    String(c.missed).padStart(7),
    String(c.falseOff).padStart(10),
    String(c.falseOn).padStart(9),
    pct(c.single, c.pieces).padStart(7),
    pct(c.single + c.clump, c.pieces).padStart(6),
    pct(c.onPiece, c.outlines).padStart(10),
    time.padStart(6),
  ];
  return cols.join(' ');
}
