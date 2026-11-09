/**
 * Screen navigation with `#/…` addresses. GitHub Pages can't rewrite URLs, and hash addresses
 * keep the installed Home Screen app opening correctly (RESEARCH §15).
 *
 * Some screens take one argument after the name, e.g. `#/puzzle/<id>` or `#/new/<id>`
 * (`routeArg`).
 */
import { signal } from '@preact/signals';

export type Route =
  'home' | 'live' | 'device' | 'settings' | 'report' | 'help' | 'log' | 'new' | 'puzzle' | 'markers' | 'scan' | 'trays' | 'accuracy' | 'progress';

export const ROUTES: Route[] = [
  'home',
  'live',
  'device',
  'settings',
  'report',
  'help',
  'log',
  'new',
  'puzzle',
  'markers',
  'scan',
  'trays',
  'accuracy',
  'progress',
];

export function parseHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return (ROUTES as string[]).includes(name) ? (name as Route) : 'home';
}

/** The part after the screen name (`#/puzzle/abc` → "abc"), or null. */
export function parseHashArg(hash: string): string | null {
  const parts = hash.replace(/^#\/?/, '').split('?')[0]!.split('/');
  if (!(ROUTES as string[]).includes(parts[0] ?? '')) return null;
  const arg = parts[1];
  if (!arg) return null;
  try {
    return decodeURIComponent(arg);
  } catch {
    return null;
  }
}

export const route = signal<Route>(parseHash(location.hash));
export const routeArg = signal<string | null>(parseHashArg(location.hash));

addEventListener('hashchange', () => {
  route.value = parseHash(location.hash);
  routeArg.value = parseHashArg(location.hash);
});

export function hashFor(to: Route, arg?: string | null): string {
  if (to === 'home') return '#/';
  return arg ? `#/${to}/${encodeURIComponent(arg)}` : `#/${to}`;
}

export function go(to: Route, arg?: string | null): void {
  const hash = hashFor(to, arg);
  if (location.hash !== hash) location.hash = hash;
  else {
    route.value = to;
    routeArg.value = arg ?? null;
  }
}

/** Changes the address without adding a Back step (e.g. `#/new` → `#/new/<id>` once the puzzle exists). */
export function replaceRoute(to: Route, arg?: string | null): void {
  const hash = hashFor(to, arg);
  try {
    history.replaceState(history.state, '', hash);
  } catch {
    location.replace(hash);
    return;
  }
  route.value = to;
  routeArg.value = arg ?? null;
}
