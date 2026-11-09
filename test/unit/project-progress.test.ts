/**
 * Piece states for the table view and the progress line, and frame sides (src/project/progress.ts).
 */
import { describe, expect, it } from 'vitest';
import { frameSide, pieceSide, pieceState, progressCounts, spotKnown, spotLabel } from '../../src/project/progress';
import type { SpotChoice } from '../../src/cv/openSpots';

const choice = (col: number, row: number, verdict: 'strong' | 'likely' | 'several', fits = true): SpotChoice => ({
  placement: { top: [{ col, row, rot: 0, score: 0, p: 0.8 }], verdict },
  fits,
});

describe('piece states', () => {
  it('green (spot known) only for a Strong or Likely spot it fits; blue when only its shape is read; grey otherwise', () => {
    expect(pieceState(true, choice(3, 4, 'strong'))).toBe('placed');
    expect(pieceState(false, choice(3, 4, 'likely'))).toBe('placed');
    expect(pieceState(true, choice(3, 4, 'several'))).toBe('shape');
    expect(pieceState(true, choice(3, 4, 'strong', false))).toBe('shape');
    expect(pieceState(false, null)).toBe('found');
    expect(spotKnown(undefined)).toBe(false);
  });

  it('progress: found · shapes read · placed on box', () => {
    expect(progressCounts(['found', 'shape', 'placed', 'placed', 'shape'])).toEqual({ found: 5, shape: 4, placed: 2 });
  });

  it('a known spot is labelled column·row, counted from 1', () => {
    expect(spotLabel(choice(25, 0, 'strong'))).toBe('26·1');
    expect(spotLabel(choice(25, 0, 'several'))).toBeNull();
  });
});

describe('frame sides', () => {
  it('the side or corner of the frame a spot is on', () => {
    expect(frameSide(0, 0, 28, 36)).toBe('top-left');
    expect(frameSide(27, 0, 28, 36)).toBe('top-right');
    expect(frameSide(27, 35, 28, 36)).toBe('bottom-right');
    expect(frameSide(0, 35, 28, 36)).toBe('bottom-left');
    expect(frameSide(5, 0, 28, 36)).toBe('top');
    expect(frameSide(27, 9, 28, 36)).toBe('right');
    expect(frameSide(5, 35, 28, 36)).toBe('bottom');
    expect(frameSide(0, 9, 28, 36)).toBe('left');
    expect(frameSide(5, 9, 28, 36)).toBeNull();
  });

  it("a piece's side only once its spot is known", () => {
    const grid = { cols: 28, rows: 36 };
    expect(pieceSide(choice(27, 0, 'strong'), grid)).toBe('top-right');
    expect(pieceSide(choice(27, 0, 'several'), grid)).toBeNull();
    expect(pieceSide(choice(10, 10, 'strong'), grid)).toBeNull();
  });
});
