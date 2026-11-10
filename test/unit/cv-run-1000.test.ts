/**
 * The 1000-piece run end to end (M7 part 4, PLAN §6 M7 "the 1000-piece synthetic run end to end"),
 * opt-in, many minutes:
 *
 *   RUN1000=1 [RUN_SET=val1000|test1000] [RUN_PUZZLES=1] npx vitest run --project unit test/unit/cv-run-1000.test.ts
 *
 * A 28 × 36 (1008-piece) puzzle in four batches of 300, 300, 300 and 108 pieces, as the owner
 * would work it, through the app's own code:
 * 1. each batch spread out on a fresh table (a new batch; leftovers set aside) and photographed:
 *    an overview, then four 2× close-ups (marker-free scans, registration, catalog merge);
 * 2. every piece placed on the photographed-lid box picture (whole picture; the colour match is
 *    measured once, from the first batch);
 * 3. a simulated owner tries each piece in the spots the app shows, best first (up to 5), answers
 *    Fits / Doesn't fit truthfully; answers rule spots out and fill spots (src/project/answers.ts);
 * 4. the end game: a photo of the nearly finished puzzle, every piece not in yet spread out again
 *    and matched only to its empty spots (M4), tried in up to 5 rounds.
 *
 * Reported per batch and in all: pieces found and read, counted twice, mixed up, put in on the
 * first try / within 5 tries / not at all, pieces in the puzzle so far, and time per photo.
 */
import { describe, expect, it } from 'vitest';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { readPiece } from '../../src/cv/readPiece';
import { buildBoxGrid, patchStats, placePiece, spotStats, type PiecePatch } from '../../src/cv/placement';
import { applyH } from '../../src/geo/homography';
import { planMerge } from '../../src/project/catalog';
import { answerView, placedPieces } from '../../src/project/answers';
import { shownPlacements, type PlacementCache } from '../../src/project/placements';
import type { PieceRow, SpotAnswer, Vec2 } from '../../src/project/types';
import { getCv } from '../helpers/cv';
import { boxPicture } from '../helpers/synthPieces';
import { renderScene, segmentationScore, type SynthScene } from '../synth/index';
import { ALL_SETS, sceneOptions } from '../synth/sets';

const RUN = process.env.RUN1000 === '1';
const SET = (process.env.RUN_SET ?? 'val1000') as keyof typeof ALL_SETS;
const buf = (s: SynthScene) => ({ data: s.rgba, width: s.width, height: s.height, stride: s.stride });
const cellOf = (id: string) => id.slice(1).split('c').map(Number).reverse() as [number, number];
const cellPlaced = (id: string) => {
  const [col, row] = cellOf(id);
  return { col, row, rot: 0 as const, at: 1, from: 'table' as const, tray: null };
};

describe.skipIf(!RUN)('the 1000-piece run, end to end', () => {
  it(`${SET}`, async () => {
    const cv = await getCv();
    const set = ALL_SETS[SET];
    const keys = [...new Set(set.items.map((i) => i.puzzleKey))].slice(0, Number(process.env.RUN_PUZZLES ?? 1));
    const all = { photos: 0, ms: 0, unregistered: 0, found: 0, visible: 0, dup: 0, mixed: 0, first: 0, within5: 0, never: 0, placed: 0, cells: 0 };
    for (const key of keys) {
      const items = set.items.filter((i) => i.puzzleKey === key);
      const pz = sceneOptions(items[0]!).puzzle;
      const box = buildBoxGrid(boxPicture(pz.art), pz.cols, pz.rows);
      const grid = { cols: pz.cols, rows: pz.rows };
      all.cells += pz.cols * pz.rows;
      let rows: PieceRow[] = [];
      const truthOf = new Map<string, string>();
      const patches = new Map<string, PiecePatch>();
      const answers: SpotAnswer[] = [];
      let colour: PlacementCache['colour'] = null;
      const byPiece: PlacementCache['byPiece'] = {};
      let nid = 0;
      const batches = [...new Set(items.map((i) => i.name.match(/-b(\d+)-/)![1]))].map(Number).sort((a, b) => a - b);
      for (const b of batches) {
        // A new batch: whatever is left on the table is set aside.
        if (b > 0) rows = rows.map((r) => (r.status === 'table' || r.status === 'pending' || r.status === 'missing' ? { ...r, status: 'aside' } : r));
        const photos = items.filter((i) => i.name.includes(`-b${b}-`)).sort((x, y) => Number(x.kind === 'detail') - Number(y.kind === 'detail'));
        let visible = 0;
        let ms = 0;
        for (const item of photos) {
          const s = await renderScene({ ...sceneOptions(item), markers: [] });
          const zoom = item.kind === 'detail' ? 2 : 1;
          const t0 = performance.now();
          const catalog = rows.filter((r) => r.status === 'table' || r.status === 'pending');
          const r = scanMarkerless(cv, buf(s), { catalog, zoom, kind: item.kind === 'detail' ? 'detail' : 'overview', table: null, pieceAreaShare: 1 });
          all.photos++;
          if (!r.registered) {
            all.unregistered++;
            continue;
          }
          const found = r.pieces.map((p) => {
            const rp = readPiece(buf(s), p, r.pxPerMm ?? 4);
            return {
              ...p,
              patch: rp ? { blob: new Blob([]), flats: rp.flats, sure: rp.sure, sides: rp.sides, sideConf: rp.sideConf, fp: rp.fp, rgba: rp.patch } : null,
            };
          });
          const view: Vec2[] = (
            [
              [0, 0],
              [s.width - 1, 0],
              [s.width - 1, s.height - 1],
              [0, s.height - 1],
            ] as Vec2[]
          ).map((c) => applyH(r.imgToCatalog!, c));
          const plan = planMerge(rows, found, {
            projectId: 'p',
            snapId: `${b}-${item.name}`,
            pxPerMm: r.pxPerMm ?? 4,
            now: all.photos + 1,
            newId: () => `n${nid++}`,
            thumbId: (id) => id,
            view,
          });
          ms += performance.now() - t0;
          // Which truth piece each sighting was: rows created or updated by it.
          const sc = segmentationScore(r.pieces, s.truth);
          const tOf = new Map(sc.matches.map((m) => [m.foundIndex, m.id]));
          const at = (row: PieceRow) => found.findIndex((f) => f.centreMm[0] === row.table.x && f.centreMm[1] === row.table.y);
          for (const row of [...plan.added, ...plan.updates]) {
            const i = at(row);
            if (i < 0) continue;
            const t = tOf.get(i);
            if (!t) continue;
            if (!truthOf.has(row.id)) truthOf.set(row.id, t);
            else if (truthOf.get(row.id) !== t) all.mixed++;
            const pt = found[i]!.patch;
            if (pt?.rgba) patches.set(row.id, pt.rgba);
          }
          const byId = new Map(rows.map((x) => [x.id, x]));
          for (const u of plan.updates) byId.set(u.id, u);
          for (const a of plan.added) byId.set(a.id, a);
          for (const id of plan.removed) byId.delete(id);
          rows = [...byId.values()];
          if (item.kind === 'overview') visible = s.truth.pieces.filter((p) => !p.faceDown && p.visibleShare > 0.99).length;
        }
        all.ms += ms;
        all.visible += visible;
        // Placement on the whole picture; the colour match from the first batch.
        const onTable = rows.filter((r) => r.status === 'table' || r.status === 'pending');
        if (!colour) {
          const st = patchStats(onTable.map((r) => patches.get(r.id)).filter((p): p is PiecePatch => Boolean(p)));
          colour = st ? { from: st, to: box.stats } : null;
        }
        for (const r of onTable) {
          const pt = patches.get(r.id);
          if (pt) byPiece[r.id] = { ts: 1, placement: placePiece(box, pt, { flats: r.patch?.flats ?? null, flatsSure: r.patch?.sure ?? false, colour }) };
        }
        const cache: PlacementCache = { boxKey: 'k', colour, byPiece };
        // The owner tries each piece, best spot first, up to 5 spots.
        const ids = new Map<string, number>();
        for (const r of onTable) {
          const t = truthOf.get(r.id);
          if (t) ids.set(t, (ids.get(t) ?? 0) + 1);
        }
        const dup = [...ids.values()].filter((n) => n > 1).reduce((s2, n) => s2 + n - 1, 0);
        let first = 0;
        let within5 = 0;
        let never = 0;
        for (const r of onTable) {
          const t = truthOf.get(r.id);
          if (!t || !patches.has(r.id)) continue;
          const [col, row] = cellOf(t);
          let ok = false;
          for (let k = 0; k < 5 && !ok; k++) {
            const project = { answers, grid: { ...grid, source: 'suggested' as const } };
            const shown = shownPlacements(cache, [r], { view: answerView(project), placed: placedPieces(rows) });
            const spot = shown.get(r.id)?.placement.top[0];
            if (!spot) break;
            const fits = spot.col === col && spot.row === row;
            answers.push({
              pieceId: r.id,
              col: spot.col,
              row: spot.row,
              rot: spot.rot,
              fits,
              at: answers.length,
              grid: `${grid.cols}x${grid.rows}`,
              verdict: 'likely',
              p: spot.p,
              rank: 0,
              from: 'piece',
              mode: 'whole',
            });
            if (fits) {
              ok = true;
              if (k === 0) first++;
              within5++;
              rows = rows.map((x) => (x.id === r.id ? { ...x, status: 'placed', placedAt: { col, row, rot: spot.rot, at: 1, from: 'table', tray: null } } : x));
            }
          }
          if (!ok) never++;
        }
        const placed = rows.filter((r) => r.status === 'placed').length;
        all.found += onTable.length;
        all.dup += dup;
        all.first += first;
        all.within5 += within5;
        all.never += never;
        console.log(
          `  ${key} batch ${b + 1}: ${visible} pieces out, ${onTable.length} read (${dup} counted twice); first try ${first}, within 5 tries ${within5}, not found in 5 ${never}; ` +
            `in the puzzle now ${placed} of ${pz.cols * pz.rows}; ${(ms / photos.length / 1000).toFixed(1)} s per photo`,
        );
      }
      // The end game: a photo of the nearly finished puzzle; every piece not in yet is spread out
      // again and matched only to the empty spots (one piece per spot, M4); the owner tries each in
      // the spot shown, the app updates after each round (up to 5 rounds).
      const done = new Set(rows.filter((r) => r.status === 'placed' && r.placedAt).map((r) => `${r.placedAt!.col},${r.placedAt!.row}`));
      const holes: Array<[number, number]> = [];
      for (let rr = 0; rr < pz.rows; rr++) for (let c = 0; c < pz.cols; c++) if (!done.has(`${c},${rr}`)) holes.push([c, rr]);
      const inH = new Set(holes.map(([c, rr]) => `${c},${rr}`));
      let left = rows.filter((r) => r.status !== 'placed' && truthOf.has(r.id) && patches.has(r.id)).map((r) => ({ ...r, status: 'table' as const }));
      const st2 = patchStats(left.map((r) => patches.get(r.id)!));
      const colour2 = st2 ? { from: st2, to: spotStats(box, holes)! } : null;
      const byPiece2: PlacementCache['byPiece'] = {};
      for (const r of left)
        byPiece2[r.id] = {
          ts: 1,
          placement: placePiece(box, patches.get(r.id)!, {
            flats: r.patch?.flats ?? null,
            flatsSure: r.patch?.sure ?? false,
            colour: colour2,
            only: (c, rr) => inH.has(`${c},${rr}`),
            full: true,
          }),
        };
      const cache2: PlacementCache = {
        boxKey: 'k2',
        colour: null,
        open: { cells: holes, sides: null, turn: 0, fit: 1, runnerUp: 0 } as never,
        byPiece: byPiece2,
      };
      const leftStart = left.length;
      const answers2: SpotAnswer[] = [];
      const before = rows.filter((r) => r.status === 'placed').length;
      let endFirst = 0;
      for (let round = 0; round < 5 && left.length; round++) {
        const shown = shownPlacements(cache2, left, { view: answerView({ answers: answers2, grid: { ...grid, source: 'suggested' } }), placed: new Map() });
        const went = new Set<string>();
        for (const r of left) {
          const ch = shown.get(r.id);
          const spot = ch?.fits ? ch.placement.top[0] : undefined;
          if (!spot) continue;
          const [col, row] = cellOf(truthOf.get(r.id)!);
          const fits = spot.col === col && spot.row === row;
          answers2.push({
            pieceId: r.id,
            col: spot.col,
            row: spot.row,
            rot: spot.rot,
            fits,
            at: answers2.length,
            grid: `${grid.cols}x${grid.rows}`,
            verdict: 'likely',
            p: spot.p,
            rank: 0,
            from: 'fill',
            mode: 'open',
          });
          if (fits) {
            went.add(r.id);
            if (round === 0) endFirst++;
          }
        }
        rows = rows.map((x) => (went.has(x.id) ? { ...x, status: 'placed', placedAt: { ...cellPlaced(truthOf.get(x.id)!) } } : x));
        left = left.filter((r) => !went.has(r.id));
      }
      const after = rows.filter((r) => r.status === 'placed').length;
      console.log(
        `  ${key} end game: ${holes.length} empty spots, ${leftStart} pieces left to place; ` +
          `${endFirst} right on the first round, ${after - before} in after 5 rounds; in the puzzle now ${after} of ${pz.cols * pz.rows}`,
      );
      all.placed += after;
    }
    const pc = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)} %`;
    console.log(
      `${SET} end to end: ${all.photos} photos (${all.unregistered} not placed), ${(all.ms / Math.max(1, all.photos) / 1000).toFixed(1)} s per photo; ` +
        `${all.found} read of ${all.visible} spread out (${all.dup} counted twice, ${all.mixed} mixed up); ` +
        `first try ${pc(all.first, all.found)}, within 5 tries ${pc(all.within5, all.found)}; in the puzzle at the end ${all.placed} of ${all.cells} (${pc(all.placed, all.cells)})`,
    );
    expect(all.placed).toBeGreaterThan(0);
  }, 7_200_000);
});
