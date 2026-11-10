/**
 * The finished-puzzle note on the Scan screen (src/app/screens/Scan.tsx): what the owner can act on (the
 * saved empty spots, the loose pieces beside the puzzle) comes right after the count, before the long
 * list of gaps, because a small screen shows only the note's first lines (review 2026-11-10). The screen
 * module reads the address, the window and the document when imported, so those are stubbed first.
 */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FinishedCheck } from '../../src/shared/apis';

let m: typeof import('../../src/app/screens/Scan');

beforeAll(async () => {
  vi.stubGlobal('location', { hash: '#/' });
  vi.stubGlobal('addEventListener', () => {});
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' });
  m = await import('../../src/app/screens/Scan');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const gaps: Array<[number, number]> = [
  [23, 0],
  [24, 0],
  [25, 0],
  [26, 0],
  [27, 0],
  [23, 1],
  [24, 1],
];
const fin = (o: Partial<FinishedCheck> = {}): FinishedCheck => ({
  thumb: null,
  cols: 28,
  rows: 36,
  colsExact: 28.02,
  rowsExact: 35.97,
  seamStrength: 0.4,
  gaps,
  gapSides: gaps.map(() => ''),
  gapsPreview: gaps.map(() => [0, 0] as [number, number]),
  cornersPreview: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  ...o,
});
const project = (box: boolean, saved = gaps.length) => ({
  grid: { cols: 28, rows: 36, source: 'suggested' as const },
  pieceCount: 1000,
  box: box ? ({} as never) : null,
  openSpots: saved ? ({ gaps: gaps.slice(0, saved) } as never) : undefined,
});

describe('the finished-puzzle note', () => {
  it('nearly finished, box picture added: count, match, what to do next, then the gaps', () => {
    const lines = m.finishedLines(fin({ loose: 9 }), project(true));
    expect(lines).toEqual([
      'Finished puzzle: 28 across × 36 down = 1,008 pieces, counted from the seams.',
      'That matches your puzzle (28 × 36).',
      "Saved: your leftover pieces will now be matched only to these 7 empty spots, one piece per spot. Scan the leftover pieces (or open Pieces on the puzzle's page).",
      'About 9 loose pieces lie next to the puzzle. They were not added: to add them, take a photo of them away from the puzzle.',
      '7 possible gaps (red squares on the last photo; counted from the top left): column 24, row 1; column 25, row 1; column 26, row 1; column 27, row 1; column 28, row 1; column 24, row 2; ….',
      'This photo is not added to your pieces.',
    ]);
  });

  it('no box picture yet, one loose piece: the same order', () => {
    const lines = m.finishedLines(fin({ loose: 1 }), project(false));
    expect(lines.slice(2, 5)).toEqual([
      'Saved these 7 empty spots: add the box picture and your leftover pieces will be matched only to them.',
      '1 loose piece lies next to the puzzle. It was not added: to add it, take a photo of it away from the puzzle.',
      expect.stringMatching(/^7 possible gaps/),
    ]);
  });

  it('no loose pieces, spots not saved: no lines for them', () => {
    const lines = m.finishedLines(fin({ loose: 0 }), project(true, 0));
    expect(lines).toHaveLength(4);
    expect(lines[2]).toMatch(/^7 possible gaps/);
    expect(lines[3]).toBe('This photo is not added to your pieces.');
  });

  it('finished with no gaps: the loose pieces before "No gaps found"', () => {
    const lines = m.finishedLines(fin({ gaps: [], gapSides: [], gapsPreview: [], loose: 3 }), project(true, 0));
    expect(lines.slice(2)).toEqual([
      'About 3 loose pieces lie next to the puzzle. They were not added: to add them, take a photo of them away from the puzzle.',
      'No gaps found: every spot has a piece.',
      'This photo is not added to your pieces.',
    ]);
  });

  it('a different grid: the advice stays right after the count', () => {
    const lines = m.finishedLines(fin({ cols: 27, loose: 2 }), { ...project(true), openSpots: undefined });
    expect(lines[1]).toBe('Your puzzle is set to 28 × 36, so nothing was saved from this photo: check the grid, or take the photo again from straight above.');
    expect(lines[2]).toMatch(/^About 2 loose pieces/);
  });

  it('a different grid with earlier saved spots of the same number: no "Saved" line (nothing is saved from it)', () => {
    const lines = m.finishedLines(fin({ cols: 18, rows: 55 }), project(true));
    expect(lines[1]).toMatch(/^Your puzzle is set to 28 × 36, so nothing was saved/);
    expect(lines.some((l) => l.startsWith('Saved'))).toBe(false);
  });

  it('the grid check: either way round, and true with no grid set', () => {
    expect(m.gridMatches({ cols: 28, rows: 36 }, { cols: 28, rows: 36 })).toBe(true);
    expect(m.gridMatches({ cols: 28, rows: 36 }, { cols: 36, rows: 28 })).toBe(true);
    expect(m.gridMatches({ cols: 28, rows: 36 }, { cols: 18, rows: 55 })).toBe(false);
    expect(m.gridMatches({ cols: 28, rows: 36 }, { cols: 27, rows: 36 })).toBe(false);
    expect(m.gridMatches(null, { cols: 18, rows: 55 })).toBe(true);
  });
});
