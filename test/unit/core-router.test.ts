/**
 * src/app/router.ts: `#/…` addresses → screens. router.ts reads `location` and calls
 * addEventListener when imported, so both are stubbed before a dynamic import.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type RouterModule = typeof import('../../src/app/router');

const listeners = new Map<string, Array<() => void>>();
const fakeLocation = { hash: '#/settings' };
let router: RouterModule;

beforeAll(async () => {
  vi.stubGlobal('location', fakeLocation);
  vi.stubGlobal('addEventListener', (type: string, fn: () => void) => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  });
  router = await import('../../src/app/router');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function fireHashChange(hash: string): void {
  fakeLocation.hash = hash;
  for (const fn of listeners.get('hashchange') ?? []) fn();
}

describe('parseHash', () => {
  it('maps every known screen', () => {
    for (const r of router.ROUTES) expect(router.parseHash(`#/${r}`)).toBe(r);
  });

  it('accepts addresses with or without the slash, and with extra parts', () => {
    expect(router.parseHash('#live')).toBe('live');
    expect(router.parseHash('#/live/')).toBe('live');
    expect(router.parseHash('#/settings/units')).toBe('settings');
    expect(router.parseHash('#/report?from=check')).toBe('report');
    expect(router.parseHash('live')).toBe('live');
  });

  it('falls back to home for empty or unknown addresses', () => {
    for (const h of ['', '#', '#/', '#/nope', '#/LIVE', '#//live', '#/ live', '#/constructor', '#/__proto__']) {
      expect(router.parseHash(h), JSON.stringify(h)).toBe('home');
    }
  });
});

describe('route signal and go()', () => {
  it('starts on the screen in the address at load time', () => {
    expect(router.route.value).toBe('settings');
  });

  it('follows hashchange events', () => {
    expect(listeners.get('hashchange')?.length).toBe(1);
    fireHashChange('#/live');
    expect(router.route.value).toBe('live');
    fireHashChange('#/whatever');
    expect(router.route.value).toBe('home');
  });

  it('go() writes the address; going home uses "#/"', () => {
    fakeLocation.hash = '#/live';
    router.go('device');
    expect(fakeLocation.hash).toBe('#/device');
    router.go('home');
    expect(fakeLocation.hash).toBe('#/');
  });

  it('go() to the current address still updates the signal (no hashchange would fire)', () => {
    fakeLocation.hash = '#/log';
    router.route.value = 'home';
    router.go('log');
    expect(fakeLocation.hash).toBe('#/log');
    expect(router.route.value).toBe('log');
  });
});

describe('a part after the argument (M9 part 4: a puzzle’s tab)', () => {
  it('parseHashSub reads it; parseHashArg is unchanged', () => {
    expect(router.parseHashArg('#/puzzle/abc/pieces')).toBe('abc');
    expect(router.parseHashSub('#/puzzle/abc/pieces')).toBe('pieces');
    expect(router.parseHashSub('#/puzzle/abc')).toBe(null);
    expect(router.parseHashSub('#/puzzle/abc/')).toBe(null);
    expect(router.parseHashSub('#/puzzle')).toBe(null);
    expect(router.parseHashSub('#/nope/abc/pieces')).toBe(null);
    expect(router.parseHashSub('#/puzzle/a%20b/more?x=1')).toBe('more');
    expect(router.parseHash('#/puzzle/abc/pieces')).toBe('puzzle');
  });

  it('hashFor writes it only with an argument', () => {
    expect(router.hashFor('puzzle', 'a b', 'picture')).toBe('#/puzzle/a%20b/picture');
    expect(router.hashFor('puzzle', 'abc', null)).toBe('#/puzzle/abc');
    expect(router.hashFor('puzzle', null, 'picture')).toBe('#/puzzle');
  });

  it('the old Progress address opens the Picture tab', () => {
    expect(router.redirectHash('#/progress/abc')).toBe('#/puzzle/abc/picture');
    expect(router.redirectHash('#/progress')).toBe('#/');
    expect(router.redirectHash('#/puzzle/abc')).toBe('#/puzzle/abc');
    expect(router.redirectHash('#/accuracy/abc')).toBe('#/accuracy/abc');
    expect(router.parseHash('#/progress/abc')).toBe('home');
  });

  it('go() with a part sets all three signals', () => {
    fakeLocation.hash = '#/puzzle/abc/more';
    router.go('puzzle', 'abc', 'more');
    expect(router.route.value).toBe('puzzle');
    expect(router.routeArg.value).toBe('abc');
    expect(router.routeSub.value).toBe('more');
    fireHashChange('#/puzzle/abc');
    expect(router.routeSub.value).toBe(null);
  });
});
