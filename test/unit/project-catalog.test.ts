/** Catalog merging (src/project/catalog.ts): rescans never add a piece twice. */
import { describe, expect, it } from 'vitest';
import { planMerge, type FoundForCatalog } from '../../src/project/catalog';
import type { PieceRow } from '../../src/project/types';

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
const ctx = (pxPerMm: number, now = 1) => ({ projectId: 'p', snapId: `s${now}`, pxPerMm, now, newId: () => `piece-${++n}`, thumbId: (id: string) => `p:p:thumb-${id}` });

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
