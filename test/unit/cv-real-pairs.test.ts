/**
 * Which pieces join (M6) on the owner's real pieces (test/fixtures/real, kept out of git; skipped
 * when missing): the 21 pieces of IMG_9276, whose true spots among the 21 holes of IMG_9280 are
 * known (test/helpers/realKiss.ts), give 24 true joins.
 *
 * 1. The go/no-go (RESEARCH §11): where each side's true partner ranks among all candidate sides by
 *    shape alone, by the colours along the seam, and by both. Measured 2026-11-09: shape top-1 0 of
 *    48, median rank 19; seam colour top-1 4 of 48, median 9. Both far below the "go" bar (median
 *    ≤ 3 and top-1 ≥ 50 %), so M6 is box-led.
 * 2. Box-led matching as the app does it (src/project/pairs.ts): top-1 over sides whose partner is
 *    present, median rank, the share of suggested pairs that are right, and the 2 × 2 squares.
 */
import { expect, it } from 'vitest';
import { placePiece, PATCH_CORE, PATCH_MARGIN, type PiecePatch } from '../../src/cv/placement';
import { sideDistance } from '../../src/cv/shapeRead';
import { rgbToLab } from '../../src/cv/tableModel';
import { shownPlacements } from '../../src/project/placements';
import { blockSuggestions, confirmedPairs, pairHealth, pairKey, pairModel, pairSuggestions, PAIRS, type Dir } from '../../src/project/pairs';
import { getCv } from '../helpers/cv';
import { ALIKE, HAS_KISS, HOLES, KISS, loadKiss, TRUTH } from '../helpers/realKiss';

// Tuning: PAIRS_SET overrides src/project/pairs.ts settings (JSON).
if (process.env.PAIRS_SET) Object.assign(PAIRS, JSON.parse(process.env.PAIRS_SET));

const DIRS: Array<[number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

it.skipIf(!HAS_KISS)(
  'which pieces join, on the real 21: shape and seam colour alone (go/no-go), then box-led',
  async () => {
    const cv = await getCv();
    const kiss = await loadKiss(cv);
    const { box, colour } = kiss;
    const ps = kiss.pieces;
    // Each real piece's turn at its true spot: the picture's best turn, then made consistent with
    // its true neighbours' knobs (tab against blank) and the puzzle's top edge (flat).
    const at = new Map<string, number>();
    for (const p of ps) if (TRUTH[p.k]) at.set(`${TRUTH[p.k]![0]},${TRUTH[p.k]![1]}`, p.k);
    const byK = new Map(ps.map((p) => [p.k, p]));
    const rot = new Map<number, number>();
    for (const p of ps) {
      const t = TRUTH[p.k];
      if (!t) continue;
      const pl = placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, colour, only: (c, rr) => c === t[0] && rr === t[1], full: true });
      const sc = pl.top[0]?.rotScores ?? [0, 0, 0, 0];
      rot.set(p.k, sc.indexOf(Math.max(...sc)));
    }
    const kindAt = (k: number, e: number) => byK.get(k)!.rd.sides[(e - rot.get(k)! + 4) % 4]!.kind;
    for (let round = 0; round < 5; round++)
      for (const p of ps) {
        const t = TRUTH[p.k];
        if (!t) continue;
        let bestQ = rot.get(p.k)!;
        let best = -Infinity;
        for (let q = 0; q < 4; q++) {
          rot.set(p.k, q);
          let s = q === bestQ ? 0.1 : 0;
          for (let e = 0; e < 4; e++) {
            const n = at.get(`${t[0] + DIRS[e]![0]},${t[1] + DIRS[e]![1]}`);
            const mine = kindAt(p.k, e);
            if (t[1] === 0 && e === 0) s += mine === 'flat' ? 2 : -2;
            if (n === undefined || n === p.k) continue;
            const theirs = kindAt(n, (e + 2) % 4);
            if ((mine === 'tab' && theirs === 'blank') || (mine === 'blank' && theirs === 'tab')) s += 1;
            else if (mine !== 'unsure' && theirs !== 'unsure') s -= 1;
          }
          if (s > best) [best, bestQ] = [s, q];
        }
        rot.set(p.k, bestQ);
      }
    // True joins: each pair of real pieces in neighbouring true cells, via the sides facing each other.
    const joins: Array<{ a: number; sa: number; b: number; sb: number }> = [];
    for (const p of ps) {
      const t = TRUTH[p.k];
      if (!t) continue;
      for (const e of [1, 2]) {
        const n = at.get(`${t[0] + DIRS[e]![0]},${t[1] + DIRS[e]![1]}`);
        if (n === undefined) continue;
        joins.push({ a: p.k, sa: (e - rot.get(p.k)! + 4) % 4, b: n, sb: (((e + 2) % 4) - rot.get(n)! + 4) % 4 });
      }
    }
    const ranks: number[] = [];
    for (const j of joins) {
      for (const [x, sx, y, sy] of [
        [j.a, j.sa, j.b, j.sb],
        [j.b, j.sb, j.a, j.sa],
      ] as const) {
        const A = byK.get(x)!.rd.sides[sx]!;
        if (A.kind !== 'tab' && A.kind !== 'blank') continue;
        const want = A.kind === 'tab' ? 'blank' : 'tab';
        const dTrue = sideDistance(A, byK.get(y)!.rd.sides[sy]!);
        const cands: number[] = [];
        for (const q of ps) {
          if (q.k === x) continue;
          q.rd.sides.forEach((s) => {
            if (s.kind === want) cands.push(sideDistance(A, s));
          });
        }
        const rank = 1 + cands.filter((d) => d < dTrue - 1e-9).length;
        ranks.push(rank);
      }
    }
    // Seam colours: each side's strip just inside the printed core, in SEG pieces along the side
    // (clockwise round the piece); a join compares one strip with the other's reversed.
    const SEG = 8;
    const DEPTH = Number(process.env.SEAM_DEPTH ?? 2);
    const strip = (patch: PiecePatch, side: number): Array<[number, number, number] | null> => {
      const S = patch.size;
      const m = PATCH_MARGIN;
      const c = PATCH_CORE;
      const out: Array<[number, number, number] | null> = [];
      for (let k = 0; k < SEG; k++) {
        const L: number[] = [];
        const A: number[] = [];
        const B: number[] = [];
        for (let u = Math.round((k * c) / SEG); u < Math.round(((k + 1) * c) / SEG); u++)
          for (let d = 1; d <= DEPTH; d++) {
            // Clockwise: top left→right, right top→bottom, bottom right→left, left bottom→top.
            const [x, y] =
              side === 0 ? [m + u, m + d] : side === 1 ? [m + c - 1 - d, m + u] : side === 2 ? [m + c - 1 - u, m + c - 1 - d] : [m + d, m + c - 1 - u];
            const i = (y * S + x) * 4;
            if (patch.rgba[i + 3]! < 128) continue;
            const lab = rgbToLab(patch.rgba[i]!, patch.rgba[i + 1]!, patch.rgba[i + 2]!);
            L.push(lab[0]);
            A.push(lab[1]);
            B.push(lab[2]);
          }
        const med = (v: number[]) => [...v].sort((p2, q2) => p2 - q2)[v.length >> 1]!;
        out.push(L.length >= 2 ? [med(L), med(A), med(B)] : null);
      }
      return out;
    };
    const seamD = (a: Array<[number, number, number] | null>, b: Array<[number, number, number] | null>) => {
      let sum = 0;
      let n = 0;
      for (let k = 0; k < SEG; k++) {
        const x = a[k];
        const y = b[SEG - 1 - k];
        if (!x || !y) continue;
        sum += Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
        n++;
      }
      return n >= SEG / 2 ? sum / n : Infinity;
    };
    const strips = new Map(ps.map((p) => [p.k, [0, 1, 2, 3].map((e) => strip(p.patch, e))]));
    const sranks: number[] = [];
    const cranks: number[] = [];
    for (const j of joins)
      for (const [x, sx, y, sy] of [
        [j.a, j.sa, j.b, j.sb],
        [j.b, j.sb, j.a, j.sa],
      ] as const) {
        const A = byK.get(x)!.rd.sides[sx]!;
        const dTrue = seamD(strips.get(x)![sx]!, strips.get(y)![sy]!);
        const shapeTrue = sideDistance(A, byK.get(y)!.rd.sides[sy]!);
        const want = A.kind === 'tab' ? 'blank' : A.kind === 'blank' ? 'tab' : null;
        const cs: number[] = [];
        const cc: number[] = [];
        for (const q of ps) {
          if (q.k === x) continue;
          q.rd.sides.forEach((sd, e) => {
            if (want && sd.kind !== want) return;
            if (!want && sd.kind === 'flat') return;
            const dd = seamD(strips.get(x)![sx]!, strips.get(q.k)![e]!);
            cs.push(dd);
            cc.push(dd + 3 * sideDistance(A, sd));
          });
        }
        sranks.push(1 + cs.filter((d) => d < dTrue - 1e-9).length);
        cranks.push(1 + cc.filter((d) => d < dTrue + 3 * shapeTrue - 1e-9).length);
      }
    const rep = (name: string, rs: number[]) => {
      rs.sort((p2, q2) => p2 - q2);
      console.log(
        `${name}: top-1 ${rs.filter((r2) => r2 === 1).length}/${rs.length} (${Math.round((100 * rs.filter((r2) => r2 === 1).length) / rs.length)} %), top-3 ${rs.filter((r2) => r2 <= 3).length}, median rank ${rs[rs.length >> 1]}`,
      );
    };
    rep('shape only', ranks);
    rep('seam colour', sranks);
    rep('seam colour + shape', cranks);
    // 2. Box-led, as the app shows it.
    const shown = shownPlacements(kiss.cache, kiss.rows);
    const model = pairModel({ shown, rows: kiss.rows, grid: KISS, open: new Set(HOLES.map(([c, r]) => `${c},${r}`)) });
    if (process.env.PAIR_DEBUG)
      for (const id of ['2', '3', '7', '17', '6', '16', '15'])
        console.log(
          `  piece #${id}: sides ${kiss.rows.find((r) => r.id === id)!.patch!.sides} conf ${kiss.rows
            .find((r) => r.id === id)!
            .patch!.sideConf!.map((c) => c.toFixed(2))
            .join(
              ' ',
            )} sure ${kiss.rows.find((r) => r.id === id)!.patch!.sure}; spot ${shown.get(id)!.placement.top[0]!.col},${shown.get(id)!.placement.top[0]!.row} turn ${shown.get(id)!.placement.top[0]!.rot}; true turn ${rot.get(Number(id))}`,
        );
    const alike = (id: string) => ALIKE.find((g) => g.includes(Number(id)))?.map(String) ?? [id];
    // True joins once each (b right of or below a), with #9 / #18 either way round.
    const trueJoin = new Set<string>();
    for (const j of joins) {
      const ta = TRUTH[j.a]!;
      const tb = TRUTH[j.b]!;
      const dir = (tb[0] - ta[0] === 1 ? 1 : 2) as Dir;
      for (const a of alike(String(j.a))) for (const b of alike(String(j.b))) trueJoin.add(pairKey(a, b, dir));
    }
    const isTrue = (a: string, b: string, dir: Dir) => trueJoin.has(pairKey(a, b, dir));
    // Per side whose partner was scanned: the true partner's rank.
    const boxRanks: number[] = [];
    for (const j of joins) {
      const ta = TRUTH[j.a]!;
      const tb = TRUTH[j.b]!;
      const dir = (tb[0] - ta[0] === 1 ? 1 : 2) as Dir;
      for (const [x, y, e] of [
        [String(j.a), String(j.b), dir],
        [String(j.b), String(j.a), ((dir + 2) % 4) as Dir],
      ] as const) {
        const list = model.sides.get(x)?.[e]?.partners ?? [];
        const at = list.findIndex((q) => isTrue(x, q.id, e) && alike(y).includes(q.id));
        boxRanks.push(at < 0 ? 99 : at + 1);
        if (process.env.PAIR_DEBUG && at !== 0) {
          const sd = model.sides.get(x)?.[e];
          console.log(
            `  #${x} side ${e} → true #${y}: rank ${at < 0 ? '—' : at + 1}; partners ${list
              .slice(0, 4)
              .map((q) => `#${q.id} ${(q.p * 100).toFixed(0)}%`)
              .join(
                ', ',
              )}; not scanned ${((sd?.notScanned ?? 0) * 100).toFixed(0)}%, in puzzle ${((sd?.inPuzzle ?? 0) * 100).toFixed(0)}%, edge ${((sd?.edge ?? 0) * 100).toFixed(0)}%, unsure ${((sd?.unsure ?? 0) * 100).toFixed(0)}%; spots ${shown
              .get(x)
              ?.placement.top.slice(0, 3)
              .map((t) => `${t.col},${t.row} ${(t.p * 100).toFixed(0)}%`)
              .join(' ')}`,
          );
        }
      }
    }
    rep('box-led', boxRanks);
    if (process.env.PAIR_DEBUG) {
      const raw = pairModel({ shown, rows: kiss.rows, grid: KISS, open: new Set(HOLES.map(([c, r]) => `${c},${r}`)), calibrate: false });
      console.log(
        `  raw pairs: ${raw.pairs
          .filter((s) => s.p >= 0.1)
          .map((s) => `${s.p.toFixed(2)}${isTrue(s.a, s.b, s.dir) ? '✓' : '✗'}`)
          .join(' ')}`,
      );
    }
    const out: Record<string, number> = {};
    for (const minP of [0.3, 0.5, 0.7]) {
      const sel = pairSuggestions(model, minP);
      const right = sel.filter((s) => isTrue(s.a, s.b, s.dir)).length;
      out[`n${minP}`] = sel.length;
      out[`ok${minP}`] = right;
      console.log(`box-led pairs at ≥ ${minP * 100} %: ${sel.length} suggested, ${right} right; ${right} of ${joins.length} true joins found`);
    }
    const blocks = blockSuggestions(pairSuggestions(model), PAIRS.blockMinP[model.mode]);
    const conf = confirmedPairs(blocks);
    const confOk = [...conf].filter((k) => {
      const [a, b, d] = k.split('|');
      return isTrue(a!, b!, Number(d) as Dir);
    }).length;
    const health = pairHealth(model);
    console.log(
      `2×2 squares: ${blocks.length} (${blocks.map((b) => `#${b.ids.join('/#')} at col ${b.col + 1} row ${b.row + 1}, ${Math.round(b.p * 100)} %`).join('; ')}); ` +
        `pairs confirmed by a square ${confOk} of ${conf.size} right; health ${health.mean.toFixed(2)} candidates within 2× of the best (${health.sides} sides)`,
    );
    // As measured 2026-11-09 (no worse): every pair at ≥ 50 % right, every square right, most sides' true partner first.
    expect(out['ok0.5']).toBe(out['n0.5']);
    expect(out['n0.5']).toBeGreaterThanOrEqual(12);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(confOk).toBe(conf.size);
    expect(boxRanks.filter((r) => r === 1).length / boxRanks.length).toBeGreaterThanOrEqual(0.7);
  },
  900_000,
);
