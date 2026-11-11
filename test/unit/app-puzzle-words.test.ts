/**
 * Words on the puzzle page and in the set-up (src/app/screens/puzzle/shared.ts): errors in plain words,
 * and the set-up steps of the way the puzzle is set up (review 2026-11-10). The screen module reads
 * the address, the window and the document when imported, so those are stubbed first.
 */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeProject } from '../../src/project/store';

let m: typeof import('../../src/app/screens/puzzle/shared');

beforeAll(async () => {
  vi.stubGlobal('location', { hash: '#/' });
  vi.stubGlobal('addEventListener', () => {});
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' });
  m = await import('../../src/app/screens/puzzle/shared');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe('errors in plain words', () => {
  it("a photo the browser can't decode: plain words instead of the browser's (WebKit, Chrome)", () => {
    expect(m.errorWords(named('InvalidStateError', 'Cannot decode the data in the argument to createImageBitmap'))).toBe(m.UNREADABLE_PHOTO);
    expect(m.errorWords(named('InvalidStateError', 'The source image could not be decoded.'))).toBe(m.UNREADABLE_PHOTO);
    expect(m.errorWords(named('EncodingError', 'The source image cannot be decoded.'))).toBe(m.UNREADABLE_PHOTO);
    expect(m.UNREADABLE_PHOTO).not.toMatch(/createImageBitmap|decode/i);
  });

  it("the app's own words and a full iPhone are kept as before", () => {
    expect(m.errorWords(new Error('That file is not a photo. Please choose a photo of the box.'))).toBe(
      'That file is not a photo. Please choose a photo of the box.',
    );
    expect(m.errorWords(new Error('Reading the photo took too long; please try again'))).toBe('Reading the photo took too long; please try again');
    expect(m.errorWords(named('QuotaExceededError', 'x'))).toMatch(/out of storage space/);
    expect(m.errorWords('plain text')).toBe('plain text');
  });
});

describe('set-up steps', () => {
  const at = (setupStep: number, tracking?: 'pieces' | 'markers') => normalizeProject({ id: 'a', setupStep, tracking });

  it('without printing (the default): 4 steps, the last one "Ready to scan", no marker steps', () => {
    expect(m.setupSteps(at(1)).slice(1)).toEqual(['Name and piece count', 'Box picture', 'Grid', 'Ready to scan']);
    expect(m.setupStatus(at(3))).toBe('Set-up: step 3 of 4 (Grid)');
    expect(m.setupStatus(at(4, 'pieces'))).toBe('Set-up: step 4 of 4 (Ready to scan)');
    expect(m.setupStatus(at(6, 'pieces'))).toBe('Set-up finished');
  });

  it('with printed markers: the 5 steps as before', () => {
    expect(m.setupSteps(at(4, 'markers')).slice(1)).toEqual([
      'Name and piece count',
      'Box picture',
      'Grid',
      'Print markers',
      'Lay out markers and photograph the table',
    ]);
    expect(m.setupStatus(at(4, 'markers'))).toBe('Set-up: step 4 of 5 (Print markers)');
    // Saved before tracking existed, past the printing step: a marker puzzle.
    expect(m.setupStatus(at(5))).toBe('Set-up: step 5 of 5 (Lay out markers and photograph the table)');
  });
});
