/**
 * Screen navigation with `#/…` addresses. GitHub Pages can't rewrite URLs, and hash addresses
 * keep the installed Home Screen app opening correctly (RESEARCH §15).
 */
import { signal } from '@preact/signals';

export type Route = 'home' | 'live' | 'device' | 'settings' | 'report' | 'help' | 'log';

export const ROUTES: Route[] = ['home', 'live', 'device', 'settings', 'report', 'help', 'log'];

export function parseHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return (ROUTES as string[]).includes(name) ? (name as Route) : 'home';
}

export const route = signal<Route>(parseHash(location.hash));

addEventListener('hashchange', () => {
  route.value = parseHash(location.hash);
});

export function go(to: Route): void {
  const hash = to === 'home' ? '#/' : `#/${to}`;
  if (location.hash !== hash) location.hash = hash;
  else route.value = to;
}
