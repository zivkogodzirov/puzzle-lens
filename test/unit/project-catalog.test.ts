/** Catalog merging (src/project/catalog.ts): rescans never add a piece twice. */
import { describe, expect, it } from 'vitest';
import { MOVED_SHAPE_MM, planMerge, shapeDistance, shapeSignature, type FoundForCatalog } from '../../src/project/catalog';
import type { PieceRow, Vec2 } from '../../src/project/types';
import { generatePuzzle } from '../synth/index';

function found(x: number, y: number, extra: Partial<FoundForCatalog> = {}): FoundForCatalog {
  const h = 12;
  return {
    outlineMm: [x - h, y - h, x + h, y - h, x + h, y + h, x - h, y + h],
    centreMm: [x, y],
    angleDeg: 0,
    areaMm2: 400,
    sizeMm: [24, 26],
    meanLab: [50, 0, 0],
    hueHist: [1, 0, 0, 0, 0, 0, 0, 0],
    flags: {},
    ...extra,
  };
}

let n = 0;
const ctx = (pxPerMm: number, now = 1) => ({
  projectId: 'p',
  snapId: `s${now}`,
  pxPerMm,
  now,
  newId: () => `piece-${++n}`,
  thumbId: (id: string) => `p:p:thumb-${id}`,
});

function apply(existing: PieceRow[], plan: ReturnType<typeof planMerge>): PieceRow[] {
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const u of plan.updates) byId.set(u.id, u);
  for (const a of plan.added) byId.set(a.id, a);
  return [...byId.values()];
}

describe('catalog merge', () => {
  it('first overview adds every whole piece; cut ones are skipped', () => {
    const plan = planMerge([], [found(100, 100), found(200, 100), found(300, 100, { flags: { cut: true } })], ctx(4));
    expect(plan.added).toHaveLength(2);
    expect(plan.skipped).toBe(1);
    expect(plan.added[0]!.outlineMm.slice(0, 2)).toEqual([-12, -12]);
  });

  it('a rescan with small position noise updates instead of duplicating', () => {
    let cat = apply([], planMerge([], [found(100, 100), found(200, 100), found(140, 160)], ctx(4, 1)));
    const plan = planMerge(cat, [found(101.5, 99), found(198.7, 101), found(141, 159)], ctx(4, 2));
    expect(plan.added).toHaveLength(0);
    expect(plan.updates).toHaveLength(3);
    cat = apply(cat, plan);
    expect(cat).toHaveLength(3);
    expect(cat.every((p) => p.seen === 2)).toBe(true);
  });

  it('a sharper close-up replaces the outline and thumbnail; a blurrier one does not', () => {
    const thumb = new Blob(['x']);
    let cat = apply([], planMerge([], [found(100, 100)], ctx(4, 1)));
    const close = planMerge(cat, [found(100.5, 100, { areaMm2: 380, thumb })], ctx(9, 2));
    expect(close.updates[0]!.bestPxPerMm).toBe(9);
    expect(close.updates[0]!.areaMm2).toBe(380);
    expect(close.thumbs).toHaveLength(1);
    cat = apply(cat, close);
    const over = planMerge(cat, [found(100.2, 100, { areaMm2: 420 })], ctx(4, 3));
    expect(over.updates[0]!.areaMm2).toBe(380);
    expect(over.updates[0]!.bestPxPerMm).toBe(9);
  });

  it('two pieces close together each keep their own match', () => {
    const cat = apply([], planMerge([], [found(100, 100), found(124, 100)], ctx(4, 1)));
    const plan = planMerge(cat, [found(125, 100), found(99, 100)], ctx(4, 2));
    expect(plan.added).toHaveLength(0);
    const ids = new Set(plan.updates.map((u) => u.id));
    expect(ids.size).toBe(2);
  });

  it('a new piece next to known ones is added', () => {
    const cat = apply([], planMerge([], [found(100, 100)], ctx(4, 1)));
    const plan = planMerge(cat, [found(100, 100), found(160, 100)], ctx(4, 2));
    expect(plan.added).toHaveLength(1);
    expect(plan.updates).toHaveLength(1);
  });
});

describe('moved pieces (owner report 2026-11-08: a piece moved a little counted as new)', () => {
  // Real piece shapes from the generator, all the same brown (like the owner's 26 pieces).
  const puzzle = generatePuzzle({ cols: 6, rows: 4, cellMm: [17.8, 19.4], seed: 21 });
  let rnd = 7;
  const jitter = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5;
  /** Piece k's outline turned by `deg` and centred at (x, y), with ±0.25 mm noise, as the reader reports it. */
  function placed(k: number, x: number, y: number, deg = 0, extra: Partial<FoundForCatalog> = {}): FoundForCatalog {
    const o = puzzle.pieces[k]!.outlineMm;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < o.length; i += 2) ((cx += o[i]!), (cy += o[i + 1]!));
    cx /= o.length / 2;
    cy /= o.length / 2;
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    const out: number[] = [];
    let a = 0;
    for (let i = 0; i < o.length; i += 2) {
      const u = o[i]! - cx;
      const v = o[i + 1]! - cy;
      out.push(x + c * u - s * v + jitter(), y + s * u + c * v + jitter());
    }
    for (let i = 0; i < out.length; i += 2) {
      const j = (i + 2) % out.length;
      a += out[i]! * out[j + 1]! - out[j]! * out[i + 1]!;
    }
    return {
      outlineMm: out,
      centreMm: [x, y],
      angleDeg: deg,
      areaMm2: Math.abs(a / 2),
      sizeMm: [22, 24],
      meanLab: [35, 12, 10],
      hueHist: [1, 0, 0, 0, 0, 0, 0, 0],
      flags: {},
      ...extra,
    };
  }
  const grid = (k: number): [number, number] => [40 + (k % 6) * 45, 40 + Math.floor(k / 6) * 45];
  const view: Vec2[] = [
    [0, 0],
    [300, 0],
    [300, 220],
    [0, 220],
  ];
  const first = () =>
    apply(
      [],
      planMerge(
        [],
        puzzle.pieces.map((_, k) => placed(k, ...grid(k))),
        { ...ctx(4, 1), view },
      ),
    );

  it('pieces moved 15–40 mm and turned are recognised, not added again', () => {
    const cat = first();
    expect(cat).toHaveLength(24);
    const moves: Record<number, [number, number, number]> = { 3: [25, 15, 40], 10: [-30, 20, 95], 17: [12, -14, 180] };
    const again = puzzle.pieces.map((_, k) => {
      const [x, y] = grid(k);
      const m = moves[k];
      return m ? placed(k, x + m[0], y + m[1], m[2]) : placed(k, x, y);
    });
    const plan = planMerge(cat, again, { ...ctx(4, 2), view });
    expect(plan.added).toHaveLength(0);
    expect(plan.moved).toBe(3);
    expect(plan.missing).toBe(0);
    const next = apply(cat, plan);
    expect(next.filter((p) => p.status === 'table')).toHaveLength(24);
    const p3 = next.find((p) => p.id === cat.find((q) => Math.hypot(q.table.x - grid(3)[0], q.table.y - grid(3)[1]) < 1)!.id)!;
    expect(p3.table.x).toBeCloseTo(grid(3)[0] + 25, 5);
  });

  it('pieces taken away are marked missing; put back at the same spot they return', () => {
    const cat = first();
    const kept = puzzle.pieces.map((_, k) => k).filter((k) => k !== 5 && k !== 12);
    const plan = planMerge(
      cat,
      kept.map((k) => placed(k, ...grid(k))),
      { ...ctx(4, 2), view },
    );
    expect(plan.missing).toBe(2);
    expect(plan.added).toHaveLength(0);
    const after = apply(cat, plan);
    expect(after.filter((p) => p.status === 'missing')).toHaveLength(2);
    const back = planMerge(
      after,
      [...kept, 5].map((k) => placed(k, ...grid(k))),
      { ...ctx(4, 3), view },
    );
    expect(back.added).toHaveLength(0);
    expect(apply(after, back).filter((p) => p.status === 'table')).toHaveLength(23);
  });

  it('a piece taken away and later put down elsewhere is recognised from the missing ones', () => {
    const cat = first();
    const without = planMerge(
      cat,
      puzzle.pieces
        .map((_, k) => k)
        .filter((k) => k !== 8)
        .map((k) => placed(k, ...grid(k))),
      { ...ctx(4, 2), view },
    );
    const after = apply(cat, without);
    const plan = planMerge(
      after,
      [
        ...puzzle.pieces
          .map((_, k) => k)
          .filter((k) => k !== 8)
          .map((k) => placed(k, ...grid(k))),
        placed(8, 285, 205, 70),
      ],
      {
        ...ctx(4, 3),
        view: [
          [0, 0],
          [400, 0],
          [400, 300],
          [0, 300],
        ],
      },
    );
    expect(plan.added).toHaveLength(0);
    expect(plan.moved).toBe(1);
  });

  it('spots outside the photo, or covered by a clump, are left alone', () => {
    const cat = first();
    // A close-up of the left half only; piece 0's spot has a clump over it.
    const half: Vec2[] = [
      [0, 0],
      [150, 0],
      [150, 220],
      [0, 220],
    ];
    const seen = puzzle.pieces.map((_, k) => k).filter((k) => grid(k)[0] <= 130 && k !== 0);
    const plan = planMerge(
      cat,
      [...seen.map((k) => placed(k, ...grid(k))), placed(0, grid(0)[0] + 3, grid(0)[1], 0, { flags: { clump: true }, areaMm2: 900 })],
      { ...ctx(4, 2), view: half },
    );
    expect(plan.missing).toBe(0);
  });

  it('a blurrier photo, or a pale piece, never marks a piece missing (it may just have been missed)', () => {
    const cat = apply(
      [],
      planMerge(
        [],
        puzzle.pieces.map((_, k) => placed(k, ...grid(k), 0, k === 2 ? { flags: { weak: true } } : {})),
        { ...ctx(9, 1), view },
      ),
    );
    const blurrier = planMerge(cat, [placed(0, ...grid(0))], { ...ctx(4, 2), view });
    expect(blurrier.missing).toBe(0);
    const sharp = planMerge(
      cat,
      puzzle.pieces
        .map((_, k) => k)
        .filter((k) => k !== 2 && k !== 3)
        .map((k) => placed(k, ...grid(k))),
      { ...ctx(9, 2), view },
    );
    expect(sharp.missing).toBe(1);
  });

  it('without the photo view, nothing is marked missing (old behaviour)', () => {
    const cat = first();
    const plan = planMerge(cat, [placed(3, 300, 300)], ctx(4, 2));
    expect(plan.missing).toBe(0);
    expect(plan.moved).toBe(0);
    expect(plan.added).toHaveLength(1);
  });

  it('two identical-looking pieces gone: no guessing, the piece is added as new', () => {
    // Pieces 30 and 31: the same shape twice (a lookalike pair).
    const twin = (x: number, y: number) => placed(7, x, y);
    const cat = apply([], planMerge([], [twin(50, 50), twin(120, 50), placed(1, 200, 50)], { ...ctx(4, 1), view }));
    const plan = planMerge(cat, [placed(1, 200, 50), twin(80, 150)], { ...ctx(4, 2), view });
    expect(plan.moved).toBe(0);
    expect(plan.added).toHaveLength(1);
    expect(plan.missing).toBe(2);
  });

  it('shape distance: a piece and its turned self are close; most other pieces are not (some look alike)', () => {
    for (const k of [2, 4, 9, 15]) {
      const a = shapeSignature(placed(k, 0, 0, 0).outlineMm);
      expect(shapeDistance(a, shapeSignature(placed(k, 0, 0, 133).outlineMm))).toBeLessThan(MOVED_SHAPE_MM);
      const others = puzzle.pieces
        .map((_, q) => q)
        .filter((q) => q !== k)
        .map((q) => shapeDistance(a, shapeSignature(placed(q, 0, 0, 0).outlineMm)))
        .sort((x, y) => x - y);
      expect(others[others.length >> 1]!).toBeGreaterThan(MOVED_SHAPE_MM);
    }
  });
});
