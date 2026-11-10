/**
 * Shared words for the screens (M9 part 1, design plan §3.7, src/app/words.ts): counts with the
 * right singular or plural, and errors as plain sentences with a next step, never the browser's text.
 */
import { describe, expect, it } from 'vitest';
import { errorWords, OUT_OF_MEMORY, plural, UNEXPECTED_ERROR, UNREADABLE_PHOTO } from '../../src/app/words';
import { BackupError } from '../../src/project/backup';

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe('counts', () => {
  it('"1 piece found", not "1 pieces found"', () => {
    expect(`${plural(1, 'piece')} found`).toBe('1 piece found');
    expect(`${plural(0, 'piece')} found`).toBe('0 pieces found');
    expect(`${plural(2, 'piece')} found`).toBe('2 pieces found');
    expect(plural(1000, 'piece')).toBe('1000 pieces');
  });

  it('other words, and irregular plurals', () => {
    expect(plural(1, 'spot')).toBe('1 spot');
    expect(plural(3, 'photo')).toBe('3 photos');
    expect(plural(1, 'batch', 'batches')).toBe('1 batch');
    expect(plural(2, 'batch', 'batches')).toBe('2 batches');
  });
});

describe('errors in plain words', () => {
  it("the app's own sentences are kept", () => {
    expect(errorWords(new Error('This puzzle is not on this iPhone.'))).toBe('This puzzle is not on this iPhone.');
    expect(errorWords(new Error('The outline is too small. Drag the dots out to the corners of the picture.'))).toBe(
      'The outline is too small. Drag the dots out to the corners of the picture.',
    );
    const backup = new BackupError("This file isn't a Puzzle Lens backup.");
    expect(errorWords(backup)).toBe("This file isn't a Puzzle Lens backup.");
  });

  it("the browser's and libraries' own text becomes a sentence with a next step", () => {
    for (const err of [
      new TypeError("undefined is not an object (evaluating 'a.b')"),
      named('InvalidStateError', 'The object is in an invalid state.'),
      named('DatabaseClosedError', 'Database has been closed'),
      named('NotAllowedError', 'The request is not allowed by the user agent or the platform in the current context.'),
      named('CvError', 'OpenCV(4.10.0) error: (-215:Assertion failed) !_src.empty() in function cvtColor'),
      new Error('Failed to execute postMessage on Worker'),
      new Error('Cannot read properties of null'),
      { foo: 1 },
    ]) {
      expect(errorWords(err), String((err as Error).message)).toBe(UNEXPECTED_ERROR);
    }
    expect(UNEXPECTED_ERROR).toMatch(/try again/i);
  });

  it('a photo that cannot be read, a full iPhone, too little memory', () => {
    expect(errorWords(named('InvalidStateError', 'Cannot decode the data in the argument to createImageBitmap'))).toBe(UNREADABLE_PHOTO);
    expect(errorWords(named('QuotaExceededError', 'x'))).toMatch(/out of storage space/);
    expect(errorWords(new RangeError('WebAssembly.Memory(): could not allocate memory: Out of memory'))).toBe(OUT_OF_MEMORY);
  });
});
