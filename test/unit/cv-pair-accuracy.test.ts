/**
 * Which pieces join (M6, PLAN §7 "Pair matching" and "2×2-confirmed pairs") end to end on synthetic
 * sets: pieces found, read and placed on the photographed-lid box picture as in the app, then the
 * box-led pairs (src/project/pairs.ts) compared with the true neighbours. Opt-in (minutes):
 *
 *   PAIR_ACCURACY=1 [PAIR_SETS=val48,val300] [PAIR_MODES=whole,gaps] [PAIRS_SET='{"vetoConf":2}'] [PAIR_RAW=1] [PAIR_DUMP=path] npx vitest run --project unit test/unit/cv-pair-accuracy.test.ts
 *
 * PAIR_RAW=1 reports the raw chances (no PAIR_CALIBRATION); PAIR_DUMP writes every pair's [mode, chance, right, set] for fitting it.
 *
 * Modes: 'whole' places each piece on the whole picture (a box of loose pieces); 'gaps' places the
 * pieces among empty spots (every scanned piece's cell + 20 % more whose pieces weren't scanned),
 * with the spots' knob shapes as a photo of the holes shows them (as in the owner's real test).
 *
 * Reported per set and mode:
 * - top-1 and median rank of the true partner, over sides whose partner was scanned;
 * - suggested pairs (chance ≥ 30 / 50 / 70 %): how many, share right, share of true joins found;
 * - pairs confirmed by a closed 2 × 2 square: share right (target ≥ 98 %) and share of true joins;
 * - calibration of every side's chances (partners, "not scanned yet", edge, "in the puzzle"):
 *   expected calibration error over 10 bins, and the Brier score;
 * - health: candidates within 2× of the best per side.
 */
import { describe, expect, it } from 'vitest';
import { buildBoxGrid, patchStats, placePiece, spotStats } from '../../src/cv/placement';
import { shownPlacements, type PlacementCache } from '../../src/project/placements';
import { blockSuggestions, confirmedPairs, DIRS, pairHealth, pairKey, pairModel, pairSuggestions, PAIRS, type Dir } from '../../src/project/pairs';
import type { PieceRow } from '../../src/project/types';
import { wilson } from '../../src/project/answers';
import { getCv } from '../helpers/cv';
import { boxPicture, cellOf, readSynthPieces } from '../helpers/synthPieces';
import { ALL_SETS, sceneOptions } from '../synth/sets';

const RUN = process.env.PAIR_ACCURACY === '1';
const SETS = (process.env.PAIR_SETS ?? 'val48').split(',') as Array<keyof typeof ALL_SETS>;
const MODES = (process.env.PAIR_MODES ?? 'whole,gaps').split(',') as Array<'whole' | 'gaps'>;
if (process.env.PAIRS_SET) Object.assign(PAIRS, JSON.parse(process.env.PAIRS_SET));

describe.skipIf(!RUN)('which pieces join (synthetic)', () => {
  for (const setName of SETS)
    it(`${setName}`, async () => {
      const cv = await getCv();
      const set = ALL_SETS[setName];
      const keys = [...new Set(set.items.map((i) => i.puzzleKey))].slice(0, Number(process.env.PAIR_PUZZLES ?? 99));
      const dumpRows: Array<[number, number, number, string]> = [];
      const res = Object.fromEntries(
        MODES.map((m) => [
          m,
          {
            ranks: [] as number[],
            sel: { 0.3: [0, 0], 0.5: [0, 0], 0.7: [0, 0] } as Record<string, [number, number]>,
            joins: 0,
            conf: [0, 0] as [number, number],
            blocks: 0,
            calib: Array.from({ length: 10 }, () => [0, 0, 0]),
            brier: [0, 0] as [number, number],
            health: [0, 0] as [number, number],
          },
        ]),
      );
      for (const key of keys) {
        const items = set.items.filter((i) => i.puzzleKey === key && i.name.includes('-b0-'));
        const pz = sceneOptions(items[0]!).puzzle;
        const box = buildBoxGrid(boxPicture(pz.art), pz.cols, pz.rows);
        // One entry per piece, as in the app's catalog (the close-up's read, which comes later, is kept).
        const pieces = [...new Map((await readSynthPieces(cv, items, pz)).map((p) => [p.id, p])).values()];
        if (!pieces.length) continue;
        const rows = pieces.map(
          (p) =>
            ({
              id: p.id,
              projectId: 'p',
              status: 'table',
              patch: { blobId: '', flats: p.flats ?? [false, false, false, false], sure: p.sure, ts: 1, sides: p.sides, sideConf: p.rawConf },
            }) as unknown as PieceRow,
        );
        const where = new Map(pieces.map((p) => [cellOf(p.id).join(','), p.id]));
        const st = patchStats(pieces.map((p) => p.patch));
        for (const mode of MODES) {
          const R = res[mode]!;
          let open: Set<string> | null = null;
          const byPiece: PlacementCache['byPiece'] = {};
          let cache: PlacementCache;
          if (mode === 'whole') {
            const colour = st ? { from: st, to: box.stats } : null;
            for (const p of pieces) byPiece[p.id] = { ts: 1, placement: placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, colour }) };
            cache = { boxKey: 'k', colour: null, byPiece };
          } else {
            const cells = pieces.map((p) => cellOf(p.id));
            const has = new Set(cells.map(([c, r]) => `${c},${r}`));
            let seed = 7 + keys.indexOf(key);
            const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
            const extra = Math.round(cells.length * 0.2);
            for (let k = 0; k < extra * 20 && cells.length < pieces.length + extra; k++) {
              const c = Math.floor(rnd() * pz.cols);
              const r = Math.floor(rnd() * pz.rows);
              if (!has.has(`${c},${r}`)) (has.add(`${c},${r}`), cells.push([c, r]));
            }
            open = has;
            const colour = st ? { from: st, to: spotStats(box, cells)! } : null;
            for (const p of pieces)
              byPiece[p.id] = {
                ts: 1,
                placement: placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, colour, only: (c, r) => has.has(`${c},${r}`), full: true }),
              };
            const truthSides = new Map(pz.pieces.map((q) => [`${q.col},${q.row}`, q.sides]));
            const sides = cells.map(([c, r]) =>
              [0, 1, 2, 3]
                .map((e) => {
                  const nc = c + DIRS[e]![0];
                  const nr = r + DIRS[e]![1];
                  if (nc < 0 || nr < 0 || nc >= pz.cols || nr >= pz.rows) return 'f';
                  if (has.has(`${nc},${nr}`)) return 'o';
                  return truthSides.get(`${c},${r}`)![e]![0];
                })
                .join(''),
            );
            cache = { boxKey: 'k', colour: null, open: { cells, sides, turn: 0, fit: 1, runnerUp: 0 } as never, byPiece };
          }
          const shown = shownPlacements(cache, rows);
          const model = pairModel({ shown, rows, grid: { cols: pz.cols, rows: pz.rows }, open, calibrate: process.env.PAIR_RAW !== '1' });
          const isTrue = (a: string, b: string, dir: Dir) => {
            const [c, r] = cellOf(a);
            return where.get(`${c + DIRS[dir]![0]},${r + DIRS[dir]![1]}`) === b;
          };
          // Ranks, and calibration over every option of every side.
          for (const p of pieces) {
            const [c, r] = cellOf(p.id);
            const four = model.sides.get(p.id);
            for (const e of [0, 1, 2, 3] as const) {
              const nc = c + DIRS[e]![0];
              const nr = r + DIRS[e]![1];
              const off = nc < 0 || nr < 0 || nc >= pz.cols || nr >= pz.rows;
              const partner = off ? undefined : where.get(`${nc},${nr}`);
              const filled = !off && open !== null && !open.has(`${nc},${nr}`);
              if (partner && (e === 1 || e === 2)) R.joins++;
              if (partner) {
                const at = four?.[e].partners.findIndex((q) => q.id === partner) ?? -1;
                R.ranks.push(at < 0 ? 99 : at + 1);
              }
              if (!four) continue;
              const s = four[e];
              const opts: Array<[number, boolean]> = [
                ...s.partners.map((q) => [q.p, q.id === partner] as [number, boolean]),
                [s.notScanned, !off && !filled && !partner],
                [s.edge, off],
                [s.inPuzzle, filled],
              ];
              // The rest ("unsure") is spread evenly over nothing: left out of calibration.
              for (const [pp, hit] of opts) {
                if (pp <= 0 && !hit) continue;
                const b = Math.min(9, Math.floor(pp * 10));
                R.calib[b]![0]! += pp;
                R.calib[b]![1]! += hit ? 1 : 0;
                R.calib[b]![2]!++;
                R.brier[0] += (pp - (hit ? 1 : 0)) ** 2;
              }
              R.brier[1]++;
            }
          }
          for (const minP of [0.3, 0.5, 0.7]) {
            const sel = pairSuggestions(model, minP);
            const S = R.sel[String(minP)]!;
            S[0] += sel.length;
            S[1] += sel.filter((s) => isTrue(s.a, s.b, s.dir)).length;
          }
          const blocks = blockSuggestions(model.pairs, PAIRS.blockMinP[model.mode]);
          if (process.env.PAIR_DUMP)
            for (const sp of model.pairs)
              dumpRows.push([mode === 'whole' ? 0 : 1, Math.round(sp.p * 1000) / 1000, isTrue(sp.a, sp.b, sp.dir) ? 1 : 0, setName]);
          R.blocks += blocks.length;
          for (const k of confirmedPairs(blocks)) {
            const [a, b, d] = k.split('|');
            R.conf[0]++;
            if (isTrue(a!, b!, Number(d) as Dir)) R.conf[1]++;
          }
          const h = pairHealth(model);
          R.health[0] += h.mean * h.sides;
          R.health[1] += h.sides;
          if (process.env.PAIR_DEBUG) console.log(`  ${key} ${mode}: ${pieces.length} pieces, ${model.pairs.length} pairs`);
        }
      }
      if (process.env.PAIR_DUMP) (await import('node:fs')).writeFileSync(`${process.env.PAIR_DUMP}-${setName}.json`, JSON.stringify(dumpRows));
      const pc = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)} %`;
      for (const mode of MODES) {
        const R = res[mode]!;
        const rs = [...R.ranks].sort((a, b) => a - b);
        const top1 = rs.filter((r) => r === 1).length;
        const [lo] = wilson(top1, rs.length);
        let ece = 0;
        let n = 0;
        for (const [sp, hits, cnt] of R.calib) {
          if (!cnt) continue;
          ece += Math.abs(sp! - hits!);
          n += cnt!;
        }
        console.log(
          `${setName} ${mode} (veto ${PAIRS.vetoConf > 1 ? 'off' : mode === 'whole' ? 'on' : 'off (empty spots)'}, squares from ≥ ${PAIRS.blockMinP[mode === 'whole' ? 'whole' : 'open'] * 100} %): ${rs.length} sides with partner scanned; top-1 ${pc(top1, rs.length)} (95 % from ${(100 * lo).toFixed(1)} %), median rank ${rs[rs.length >> 1] === 99 ? 'not found' : rs[rs.length >> 1]}; ` +
            Object.entries(R.sel)
              .map(([k, [s, ok]]) => `≥ ${Number(k) * 100} %: ${s} pairs, right ${pc(ok, s)}, finds ${pc(ok, R.joins)} of ${R.joins} joins`)
              .join('; ') +
            `; 2×2 squares ${R.blocks}, confirmed pairs ${R.conf[0]} right ${pc(R.conf[1], R.conf[0])} (finds ${pc(R.conf[1], R.joins)}); ` +
            `calibration error ${(ece / Math.max(1, n)).toFixed(3)}, Brier ${(R.brier[0] / Math.max(1, R.brier[1])).toFixed(3)}; health ${(R.health[0] / Math.max(1, R.health[1])).toFixed(2)}`,
        );
        if (process.env.PAIR_CALIB)
          console.log(
            R.calib
              .map(([sp, hits, cnt], i) => (cnt ? `  ${i * 10}–${i * 10 + 10} %: said ${pc(sp!, cnt)}, was ${pc(hits!, cnt)} (${cnt})` : ''))
              .filter(Boolean)
              .join('\n'),
          );
        expect(rs.length).toBeGreaterThan(0);
      }
    }, 3_600_000);
});
