/**
 * Fill this spot (src/project/fillSpot.ts): from one spot on the box picture to the pieces that may
 * go there, the piece chosen for it first.
 */
import { describe, expect, it } from 'vitest';
import { candidatesFor, nearestSpot } from '../../src/project/fillSpot';
import type { SpotChoice } from '../../src/cv/openSpots';

const choice = (spots: Array<[number, number, number]>, fits = true, verdict: 'strong' | 'likely' | 'several' = 'strong'): SpotChoice => ({
  placement: { top: spots.map(([col, row, p]) => ({ col, row, rot: 0, score: 0, p })), verdict },
  fits,
});

describe('fill this spot', () => {
  const shown = new Map<string, SpotChoice>([
    // a: chosen for (3, 0); b: chosen for (4, 0) but also possible at (3, 0); c: fits no spot; d: a tiny chance only.
    [
      'a',
      choice([
        [3, 0, 0.8],
        [4, 0, 0.15],
      ]),
    ],
    [
      'b',
      choice(
        [
          [4, 0, 0.7],
          [3, 0, 0.2],
        ],
        true,
        'likely',
      ),
    ],
    ['c', choice([[3, 0, 0.3]], false)],
    [
      'd',
      choice([
        [5, 0, 0.9],
        [3, 0, 0.01],
      ]),
    ],
  ]);

  it('the piece chosen for the spot comes first, then the others by chance, each with its own best spot', () => {
    const c = candidatesFor(shown, 3, 0);
    expect(c.map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(c[0]).toMatchObject({ chosen: true, verdict: 'strong', p: 0.8, best: null });
    // c fits none of the spots: listed as possible (its chance), with no best spot of its own.
    expect(c[1]).toMatchObject({ chosen: false, p: 0.3, best: null });
    expect(c[2]).toMatchObject({ chosen: false, p: 0.2, best: { col: 4, row: 0 } });
  });

  it('a spot no piece has (or only with a tiny chance): nobody', () => {
    expect(candidatesFor(shown, 9, 9)).toEqual([]);
    expect(candidatesFor(shown, 5, 0).map((x) => x.id)).toEqual(['d']);
    expect(candidatesFor(new Map([['d', shown.get('d')!]]), 3, 0)).toEqual([]);
  });

  it('on the whole picture, several pieces can have the same best spot: all count as chosen', () => {
    const whole = new Map<string, SpotChoice>([
      ['x', choice([[1, 1, 0.5]], true, 'several')],
      ['y', choice([[1, 1, 0.9]])],
    ]);
    expect(candidatesFor(whole, 1, 1).map((c) => [c.id, c.chosen])).toEqual([
      ['y', true],
      ['x', true],
    ]);
  });

  it('a tap goes to the nearest empty spot within 3 spots, else to none', () => {
    const spots: Array<[number, number]> = [
      [23, 0],
      [24, 0],
      [16, 6],
    ];
    expect(nearestSpot(spots, 24.2, 0.6)).toEqual([24, 0]);
    expect(nearestSpot(spots, 17.9, 7.9)).toEqual([16, 6]);
    expect(nearestSpot(spots, 5, 30)).toBeNull();
  });
});
