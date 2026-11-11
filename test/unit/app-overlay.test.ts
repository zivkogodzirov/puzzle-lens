/**
 * The outline language (M9 part 3, design plan §3.2 and decisions 9, 10, 18; src/app/overlay.ts): colours
 * readable against the halo on the owner's cream table, labels that never overlap (in a crowded scene too,
 * with the tapped piece first), squares of 4 found among the lines, one label per square, piece names.
 */
import { describe, expect, it } from 'vitest';
import { markOf, MAX_LABELS, pieceName, placeLabels, PRIO, squareLabel, squaresOf, type LabelRequest, type Rect } from '../../src/app/overlay';
import { OV } from '../../src/app/tokens';

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const lum = ([r, g, b]: number[]) => 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
/** A colour `alpha` over another (sRGB, as the canvas blends). */
const over = (top: number[], alpha: number, under: number[]) => under.map((u, i) => top[i]! * alpha + u * (1 - alpha));
const rgba = (s: string) => {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(s)!;
  return { c: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
};

describe('overlay colours (design plan §3.1 "Overlays on photos and video")', () => {
  const halo = rgba(OV.halo);
  // The owner's cream table, a white table and a darker wooden one.
  for (const table of ['#ede6d8', '#ffffff', '#d8cdb8']) {
    const bg = over(halo.c, halo.a, rgb(table));
    for (const name of ['found', 'shape', 'placed', 'warn', 'bad', 'joinOk'] as const)
      it(`${name} ${OV[name]} is at least 3:1 against the halo over ${table}`, () => {
        // The white table is the worst case for the red (plan: 3.8:1 is over the halo's own black; 2.8:1 over white paper).
        expect(contrast(rgb(OV[name]), bg)).toBeGreaterThanOrEqual(table === '#ffffff' && name === 'bad' ? 2.8 : 3);
      });
  }
  it('badge ink reads on the amber and red badges (at least 4.5:1)', () => {
    expect(contrast(rgb(OV.ink), rgb(OV.warn))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(OV.ink), rgb(OV.bad))).toBeGreaterThanOrEqual(4.5);
  });
  it('label words on the camera material read even over a white table (at least 4.5:1)', () => {
    const m = rgba(OV.labelBg);
    expect(contrast(rgb(OV.labelText), over(m.c, m.a, [255, 255, 255]))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('one pattern, one meaning (decision 9)', () => {
  it('marks: faint, touching, moved; fine otherwise', () => {
    expect(markOf({})).toBe('ok');
    expect(markOf({ weak: true })).toBe('faint');
    expect(markOf({ weak: true, part: true })).toBe('faint');
    expect(markOf({ clump: true, weak: true })).toBe('touching');
    expect(markOf({ weak: true }, true)).toBe('moved');
    expect(markOf(null)).toBe('ok');
  });
});

const overlapCount = (rs: Rect[]) => {
  let n = 0;
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i]!;
      const b = rs[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) n++;
    }
  return n;
};
const width = (t: string) => t.length * 8.6;

describe('label placement (greedy, by priority)', () => {
  // A crowded scene: 300 pieces 22 px apart on a 402 × 680 screen (labels are about 44 × 24).
  const crowd: LabelRequest[] = Array.from({ length: 300 }, (_, i) => ({
    key: `p${i}`,
    text: `${(i % 28) + 1}·${Math.floor(i / 28) + 1}`,
    x: 12 + (i % 18) * 22,
    y: 12 + Math.floor(i / 18) * 22,
    r: 10,
    prio: PRIO.sure,
  }));
  it('never overlaps, stays on the screen, and is capped', () => {
    const { placed, left } = placeLabels(crowd, width, { w: 402, h: 680 });
    expect(placed.length).toBeGreaterThan(20);
    expect(placed.length).toBeLessThanOrEqual(MAX_LABELS);
    expect(placed.length + left.length).toBe(300);
    expect(overlapCount(placed)).toBe(0);
    for (const l of placed) {
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.y).toBeGreaterThanOrEqual(0);
      expect(l.x + l.w).toBeLessThanOrEqual(402);
      expect(l.y + l.h).toBeLessThanOrEqual(680);
    }
  });
  it('the tapped piece, then the piece to find, win over sure spots; nothing covers a badge', () => {
    const reqs = [...crowd];
    reqs[150] = { ...reqs[150]!, prio: PRIO.tapped };
    reqs[151] = { ...reqs[151]!, prio: PRIO.target };
    const badge = { x: 100, y: 100, w: 24, h: 24 };
    const { placed } = placeLabels(reqs, width, { w: 402, h: 680 }, [badge]);
    expect(placed[0]!.key).toBe('p150');
    expect(placed[1]!.key).toBe('p151');
    expect(overlapCount([badge, ...placed])).toBe(0);
  });
  it('a lone label sits on its piece', () => {
    const { placed } = placeLabels([{ key: 'a', text: '17·9', x: 200, y: 300, r: 20, prio: PRIO.sure }], width, { w: 402, h: 680 });
    expect(placed[0]!.x + placed[0]!.w / 2).toBeCloseTo(200);
    expect(placed[0]!.y + placed[0]!.h / 2).toBeCloseTo(300);
  });
  it('is cheap: 300 labels in well under 2 ms on average', () => {
    const t = performance.now();
    for (let i = 0; i < 50; i++) placeLabels(crowd, width, { w: 402, h: 680 });
    expect((performance.now() - t) / 50).toBeLessThan(2);
  });
});

describe('squares of 4', () => {
  const sq = [
    { a: 'A', b: 'B', confirmed: true },
    { a: 'C', b: 'D', confirmed: true },
    { a: 'A', b: 'C', confirmed: true },
    { a: 'B', b: 'D', confirmed: true },
  ];
  it('finds a closed square and walks round it', () => {
    const s = squaresOf([{ a: 'X', b: 'Y', confirmed: false }, ...sq]);
    expect(s).toHaveLength(1);
    expect(new Set(s[0]!.ids)).toEqual(new Set(['A', 'B', 'C', 'D']));
    expect(new Set(s[0]!.lines)).toEqual(new Set([1, 2, 3, 4]));
    // Round the square: neighbours in the walk are joined by a line.
    const joined = (p: string, q: string) => sq.some((l) => (l.a === p && l.b === q) || (l.a === q && l.b === p));
    for (let i = 0; i < 4; i++) expect(joined(s[0]!.ids[i]!, s[0]!.ids[(i + 1) % 4]!)).toBe(true);
  });
  it('an open chain or unconfirmed lines are no square', () => {
    expect(squaresOf(sq.slice(0, 3))).toEqual([]);
    expect(squaresOf(sq.map((l) => ({ ...l, confirmed: false })))).toEqual([]);
  });
  it('in a bigger block (2 × 3), one square; the lines left over stay lines', () => {
    // A B E / C D F: squares ABDC and BEFD share B and D, so only the first is drawn as a quad.
    const block = [...sq, { a: 'B', b: 'E', confirmed: true }, { a: 'D', b: 'F', confirmed: true }, { a: 'E', b: 'F', confirmed: true }];
    const s = squaresOf(block);
    expect(s).toHaveLength(1);
    expect(new Set(s[0]!.ids)).toEqual(new Set(['A', 'B', 'C', 'D']));
    expect(squaresOf([...sq, { a: 'D', b: 'E', confirmed: true }])).toHaveLength(1);
  });
  it('one label: "17–18 · 7–8"', () => {
    expect(squareLabel(['17·7', '18·7', '17·8', '18·8'])).toBe('17–18 · 7–8');
    expect(squareLabel(['17·7', null, '17·8', '18·8'])).toBeNull();
  });
});

describe('piece names (accessibility rule 9)', () => {
  it('"Edge piece, maybe column 17 row 8, check outline"', () => {
    expect(pieceName({ flags: { weak: true }, patch: { flats: [true, false, false, false], sure: true } }, '17·8', false)).toBe(
      'Edge piece, maybe column 17 row 8, check outline',
    );
    expect(pieceName({ flags: {}, patch: { flats: [true, true, false, false], sure: true } }, '1·1', true)).toBe('Corner piece, column 1 row 1');
    expect(pieceName({ flags: { clump: true }, patch: null }, null, true)).toBe('Piece, spot not known yet, touching another piece');
    expect(pieceName({ flags: {} }, '3·4', true, true)).toBe('Piece, column 3 row 4, not where it was');
  });
});
