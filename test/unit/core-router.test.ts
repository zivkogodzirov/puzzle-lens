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
