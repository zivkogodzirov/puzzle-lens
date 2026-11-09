/**
 * Fits / Doesn't fit (M5 part 2) on the owner's real pieces and holes (test/fixtures/real, kept out
 * of git; skipped when missing): the 21 pieces of IMG_9276 placed among the 21 holes of IMG_9280 on
 * the box picture (shot-9294), then a simulated owner tries each piece in its first suggested spot
 * and answers truthfully (the truth below, worked out in M4 from knob shapes and the finished
 * puzzle). The answers must lead every real piece into its hole, nearly all on the first try.
 */
import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { puzzleQuad, readAssembledGrid } from '../../src/cv/assembledGrid';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { readShape, READ_OK } from '../../src/cv/shapeRead';
import { buildBoxGrid, extractPatch, patchStats, placePiece, spotStats, type PiecePatch, type Placement } from '../../src/cv/placement';
import { shownPlacements, type PlacementCache } from '../../src/project/placements';
import { accuracyOf, answerView } from '../../src/project/answers';
import type { PieceRow, SpotAnswer, Vec2 } from '../../src/project/types';
import { getCv } from '../helpers/cv';
import { decodeRgba, REAL_DIR } from '../helpers/realFixtures';

const HOLES: Array<[number, number]> = [];
for (const r of [0, 1]) for (let c = 23; c <= 27; c++) HOLES.push([c, r]);
for (const r of [6, 7]) for (let c = 16; c <= 19; c++) HOLES.push([c, r]);
for (let c = 16; c <= 18; c++) HOLES.push([c, 8]);
// Truth from M4 (piece # in scan order of IMG_9276 → cell); #9 and #18 are interchangeable; #1 and #19 aren't pieces.
const TRUTH: Record<number, Array<[number, number]>> = {
  2: [[16, 7]],
  3: [[16, 8]],
  4: [[18, 6]],
  5: [[19, 7]],
  6: [[17, 8]],
  7: [[16, 6]],
  8: [[25, 0]],
  9: [
    [24, 1],
    [23, 1],
  ],
  10: [[26, 0]],
  11: [[26, 1]],
  12: [[27, 0]],
  13: [[27, 1]],
  14: [[25, 1]],
  15: [[18, 7]],
  16: [[18, 8]],
  17: [[17, 7]],
  18: [
    [23, 1],
    [24, 1],
  ],
  20: [[24, 0]],
  21: [[17, 6]],
};

const HAS = ['shot-9294.jpeg', 'IMG_9280.jpeg', 'IMG_9276.jpeg'].every((f) => existsSync(REAL_DIR + f));

it.skipIf(!HAS)(
  'Fits / Doesn’t fit on the real 21: every real piece goes in, nearly all on the first try',
  async () => {
    const cv = await getCv();
    const BW = 1120;
    const BH = 1569;
    const shot = await decodeRgba(REAL_DIR + 'shot-9294.jpeg');
    const boxA = new Uint8Array(BW * BH * 4);
    for (let y = 0; y < BH; y++) boxA.set(shot.data.subarray((1059 + y) * shot.stride + 400, (1059 + y) * shot.stride + 400 + BW * 4), y * BW * 4);
    const box = buildBoxGrid({ data: boxA, width: BW, height: BH, stride: BW * 4 }, 28, 36);
    const holes = await decodeRgba(REAL_DIR + 'IMG_9280.jpeg');
    const rh = scanMarkerless(cv, holes, { catalog: [], zoom: 1, kind: 'overview', table: null });
    const reg = rh.regions.filter((g) => g.kind === 'assembled').sort((a, b) => b.areaMm2 - a.areaMm2)[0]!;
    const g = readAssembledGrid(cv, holes, puzzleQuad(cv, holes, reg.outlineImg)!, { pieceCount: 1000, grid: { cols: 28, rows: 36 } })!;
    const sideOf = new Map(g.gaps.map(([c, r], k) => [`${c},${r}`, g.gapSides[k]!]));
    const spotSides = HOLES.map(([c, r]) => sideOf.get(`${c},${r}`) ?? '????');
    const img = await decodeRgba(REAL_DIR + 'IMG_9276.jpeg');
    const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
    const ppm = r.pxPerMm ?? 4;
    const ps: Array<{ id: string; patch: PiecePatch; flats: boolean[]; sure: boolean; sides: string; conf: number[] }> = [];
    r.pieces.forEach((p) => {
      if (p.flags.cut || p.flags.clump) return;
      const rd = readShape(
        p.outlineImg.map((v) => v / ppm),
        null,
      );
      if (!rd) return;
      const patch = extractPatch(
        img,
        rd.corners.map(([x, y]) => [x * ppm, y * ppm] as Vec2),
        p.outlineImg,
      );
      if (!patch) return;
      const sure = Boolean(rd.kind) && rd.quality >= READ_OK;
      ps.push({
        id: String(ps.length + 1),
        patch,
        flats: rd.sides.map((s) => s.kind === 'flat'),
        sure,
        sides: rd.sides.map((s) => (s.kind === 'unsure' ? 'u' : s.kind[0])).join(''),
        conf: rd.sides.map((s) => s.conf),
      });
    });
    const st = patchStats(ps.map((p) => p.patch))!;
    const colour = { from: st, to: spotStats(box, HOLES)! };
    const inH = new Set(HOLES.map(([c, rr]) => rr * 28 + c));
    const byPiece: PlacementCache['byPiece'] = {};
    for (const p of ps)
      byPiece[p.id] = {
        ts: 1,
        placement: placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, colour, only: (c, rr) => inH.has(rr * 28 + c), full: true }),
      };
    const cache: PlacementCache = { boxKey: 'k', colour: null, open: { cells: HOLES, sides: spotSides, turn: 0, fit: 1, runnerUp: 0 } as never, byPiece };
    const rows = new Map<string, PieceRow>(
      ps.map((p) => [
        p.id,
        {
          id: p.id,
          projectId: 'p',
          status: 'table',
          patch: { blobId: '', flats: p.flats, sure: p.sure, ts: 1, sides: p.sides, sideConf: p.conf },
        } as unknown as PieceRow,
      ]),
    );
    const isRight = (id: string, c: number, rr: number) => (TRUTH[Number(id)] ?? []).some(([tc, tr]) => tc === c && tr === rr);

    for (const strategy of ['most sure first', 'in list order'] as const) {
      const answers: SpotAnswer[] = [];
      const tries = new Map<string, number>();
      const placedRows = new Map<string, PieceRow>();
      const given: string[] = [];
      const firstTry: string[] = [];
      for (let step = 0; step < 300; step++) {
        const view = answerView({ answers, grid: { cols: 28, rows: 36 } as never });
        const left = [...rows.values()].filter((p) => !placedRows.has(p.id) && !given.includes(p.id));
        if (!left.length) break;
        const shown = shownPlacements(cache, left, { view, placed: placedRows });
        const order =
          strategy === 'most sure first'
            ? [...left].sort((a, b) => (shown.get(b.id)?.placement.top[0]?.p ?? 0) - (shown.get(a.id)?.placement.top[0]?.p ?? 0))
            : left;
        const p = order[0]!;
        const c = shown.get(p.id);
        const t = c?.placement.top[0];
        if (!c || !t) {
          given.push(p.id);
          continue;
        }
        const fits = isRight(p.id, t.col, t.row);
        tries.set(p.id, (tries.get(p.id) ?? 0) + 1);
        answers.push({
          pieceId: p.id,
          col: t.col,
          row: t.row,
          rot: t.rot,
          fits,
          at: step,
          grid: '28x36',
          verdict: c.placement.verdict,
          p: t.p,
          rank: 0,
          from: 'piece',
          mode: 'open',
        });
        if (fits) {
          if (tries.get(p.id) === 1) firstTry.push(p.id);
          placedRows.set(p.id, { ...rows.get(p.id)!, status: 'placed', placedAt: { col: t.col, row: t.row, rot: t.rot, at: step, from: 'table', tray: null } });
        }
      }
      const realPieces = Object.keys(TRUTH);
      const placedReal = realPieces.filter((k) => placedRows.has(k));
      const tryCounts = placedReal.map((k) => tries.get(k)!);
      expect(placedReal.length, strategy).toBe(realPieces.length);
      expect(firstTry.length, strategy).toBeGreaterThanOrEqual(17);
      const acc = accuracyOf(answers);
      const pct = (a: { right: number; total: number }) => (a.total ? `${a.right}/${a.total}` : '–');
      console.log(
        `${strategy}: ${placedReal.length}/${realPieces.length} real pieces placed, ${firstTry.length} on the first try; tries per placed piece ${(tryCounts.reduce((s, x) => s + x, 0) / tryCounts.length).toFixed(2)} (max ${Math.max(...tryCounts)}); total answers ${answers.length} (incl. ${(tries.get('1') ?? 0) + (tries.get('19') ?? 0)} for the 2 non-pieces); given up: ${given.join(',') || 'none'}\n` +
          `   accuracy page: Strong ${pct(acc.first.strong)}, Likely ${pct(acc.first.likely)}, Several ${pct(acc.first.several)}; calibration ${acc.calibration.map((b) => `${b.label}: said ${Math.round(b.said * 100)} %, right ${b.right}/${b.total}`).join('; ')}`,
      );
    }
    // Baseline without answers changing anything: the owner goes down each piece's own list.
    const plain = shownPlacements(cache, [...rows.values()]);
    let total = 0;
    let found = 0;
    for (const k of Object.keys(TRUTH)) {
      const top = plain.get(k)?.placement.top ?? [];
      const idx = top.findIndex((t) => isRight(k, t.col, t.row));
      if (idx >= 0) {
        found++;
        total += idx + 1;
      }
    }
    console.log(`without using answers: ${found}/19 have the right hole in their list at all; tries ${total} for those (${(total / found).toFixed(2)} each)`);
  },
  1_800_000,
);
