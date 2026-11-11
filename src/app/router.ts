/**
 * Screen navigation with `#/…` addresses. GitHub Pages can't rewrite URLs, and hash addresses
 * keep the installed Home Screen app opening correctly (RESEARCH §15).
 *
 * Some screens take one argument after the name, e.g. `#/puzzle/<id>` or `#/new/<id>`
 * (`routeArg`), and a part after that (`routeSub`), e.g. the puzzle's tab: `#/puzzle/<id>/pieces`
 * (M9 part 4). Older addresses that moved are rewritten in place (`REDIRECTS`): `#/progress/<id>` is
 * now the puzzle's Picture tab, `#/puzzle/<id>/picture`.
 */
import { signal } from '@preact/signals';

export type Route =
  | 'home'
  | 'live'
  | 'device'
  | 'settings'
  | 'report'
  | 'help'
  | 'log'
  | 'new'
  | 'puzzle'
  | 'markers'
  | 'scan'
  | 'trays'
  | 'accuracy'
  | 'ui'
  // M9 part 4 pieces: pages pushed from a puzzle's Pieces tab: `#/joins/<id>` (Which pieces join), `#/sort/<id>` (Sort into trays).
  | 'joins'
  | 'sort';

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
  'ui',
  // M9 part 4 pieces:
  'joins',
  'sort',
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

/** The part after the argument (`#/puzzle/abc/pieces` → "pieces"), or null. */
export function parseHashSub(hash: string): string | null {
  const parts = hash.replace(/^#\/?/, '').split('?')[0]!.split('/');
  if (!(ROUTES as string[]).includes(parts[0] ?? '') || !parts[1]) return null;
  const sub = parts[2];
  if (!sub) return null;
  try {
    return decodeURIComponent(sub);
  } catch {
    return null;
  }
}

/**
 * Addresses that moved (M9 part 4): the old screen name → its new address, from the old address's
 * argument. `#/progress/<id>` (the old Progress screen) → the puzzle's Picture tab.
 */
const REDIRECTS: Record<string, (arg: string | null) => string> = {
  progress: (arg) => (arg ? hashFor('puzzle', arg, 'picture') : hashFor('home')),
};

/** The address to show for `hash`: the same, or where an older address moved to. */
export function redirectHash(hash: string): string {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  const to = Object.prototype.hasOwnProperty.call(REDIRECTS, name) ? REDIRECTS[name] : undefined;
  if (!to) return hash;
  const parts = hash.replace(/^#\/?/, '').split('?')[0]!.split('/');
  let arg: string | null = null;
  try {
    arg = parts[1] ? decodeURIComponent(parts[1]) : null;
  } catch {
    arg = null;
  }
  return to(arg);
}

/** Rewrites a moved address in place (no Back step), before the screen is chosen. */
function followRedirect(): void {
  const to = redirectHash(location.hash);
  if (to === location.hash) return;
  try {
    history.replaceState(history.state, '', to);
  } catch {
    location.replace(to);
  }
}

followRedirect();
export const route = signal<Route>(parseHash(location.hash));
export const routeArg = signal<string | null>(parseHashArg(location.hash));
export const routeSub = signal<string | null>(parseHashSub(location.hash));

/**
 * The addresses we came from by go() (newest last), so a back button can return with the browser's own Back
 * when that is where it leads (goBack). Kept in step with the edge swipe / browser Back by popstate.
 */
const trail: string[] = [];
let ownNav = false;
const norm = (h: string): string => (h === '' || h === '#' ? '#/' : h);
addEventListener('popstate', () => {
  if (ownNav) ownNav = false;
  else trail.pop();
});

addEventListener('hashchange', () => {
  ownNav = false;
  followRedirect();
  route.value = parseHash(location.hash);
  routeArg.value = parseHashArg(location.hash);
  routeSub.value = parseHashSub(location.hash);
});

/** `sub` (e.g. a puzzle's tab) is written only with an argument: `#/puzzle/<id>/<sub>`. */
export function hashFor(to: Route, arg?: string | null, sub?: string | null): string {
  if (to === 'home') return '#/';
  if (!arg) return `#/${to}`;
  return sub ? `#/${to}/${encodeURIComponent(arg)}/${encodeURIComponent(sub)}` : `#/${to}/${encodeURIComponent(arg)}`;
}

export function go(to: Route, arg?: string | null, sub?: string | null): void {
  const hash = hashFor(to, arg, sub);
  if (location.hash !== hash) {
    trail.push(norm(location.hash));
    ownNav = true;
    location.hash = hash;
  } else {
    route.value = to;
    routeArg.value = arg ?? null;
    routeSub.value = (arg && sub) || null;
  }
}

/**
 * Changes the address without adding a Back step (e.g. `#/new` → `#/new/<id>` once the puzzle exists, or
 * from one of a puzzle's tabs to another: `#/puzzle/<id>/pieces`).
 */
export function replaceRoute(to: Route, arg?: string | null, sub?: string | null): void {
  const hash = hashFor(to, arg, sub);
  try {
    history.replaceState(history.state, '', hash);
  } catch {
    location.replace(hash);
    return;
  }
  route.value = to;
  routeArg.value = arg ?? null;
  routeSub.value = (arg && sub) || null;
}

/**
 * A screen's back button: to its parent. When the parent is the address we came from, the browser's own Back
 * goes there, so the edge swipe afterwards doesn't land on this screen again (review 2026-11-11: Pieces → Which
 * pieces join → ‹ Pieces, then a swipe went back to Which pieces join). Otherwise the parent replaces this screen.
 */
export function goBack(to: Route, arg?: string | null, sub?: string | null): void {
  const hash = hashFor(to, arg, sub);
  if (trail.length && trail[trail.length - 1] === hash) {
    trail.pop();
    ownNav = true;
    history.back();
  } else replaceRoute(to, arg, sub);
}
