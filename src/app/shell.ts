/**
 * The app shell around the screens (M9 part 1): each screen's title in the tab/app switcher,
 * focus on its heading after a screen change, the screen kept awake on the puzzle screens, and
 * the last puzzle reopened at launch.
 */
import { useEffect, useRef } from 'preact/hooks';
import { holdAwake } from '../camera/wakeLock';
import { getCurrentProjectId, getProject } from '../project/store';
import { hashFor, route, routeArg, type Route } from './router';
import { logInfo, logWarn } from '../log/logger';

export const APP_NAME = 'Puzzle Lens';

/** Each screen's name, as its heading says it. */
const SCREEN_NAME: Record<Route, string> = {
  home: APP_NAME,
  live: 'Live camera',
  device: 'Device check',
  settings: 'Settings',
  report: 'Send report',
  help: 'Setup guide',
  log: 'Activity log',
  new: 'New puzzle',
  puzzle: 'Puzzle',
  markers: 'Marker sheets',
  scan: 'Scan pieces',
  trays: 'Tray labels',
  accuracy: 'How often is the app right?',
  progress: 'Progress',
};

/** Screens about one puzzle (`#/<screen>/<puzzle id>`): their title names the puzzle. */
const PUZZLE_SCREENS: ReadonlySet<Route> = new Set(['puzzle', 'new', 'markers', 'scan', 'trays', 'accuracy', 'progress']);

/** Screens that keep the screen on while open (the camera keeps it on by itself). */
const AWAKE_SCREENS: ReadonlySet<Route> = new Set(['puzzle', 'progress']);

/**
 * The page title: "Puzzle Lens" on Home, "Harbour · Puzzle Lens" on a puzzle's page,
 * "Progress · Harbour · Puzzle Lens" on its other screens, "Settings · Puzzle Lens" elsewhere.
 */
export function screenTitle(r: Route, puzzleName?: string | null): string {
  if (r === 'home') return APP_NAME;
  const parts = r === 'puzzle' && puzzleName ? [puzzleName] : puzzleName ? [SCREEN_NAME[r], puzzleName] : [SCREEN_NAME[r]];
  return [...parts, APP_NAME].join(' · ');
}

/** Sets the title from a screen that knows the puzzle's name (e.g. after renaming it). */
export function setScreenTitle(r: Route, puzzleName?: string | null): void {
  document.title = screenTitle(r, puzzleName);
}

/** Moves focus to the screen's heading, without scrolling and without a ring for touch users. */
function focusHeading(): void {
  const h = [...document.querySelectorAll<HTMLElement>('#app .app h1')].find((e) => !e.closest('.test-sheet, .banner'));
  if (!h) return;
  if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
  h.classList.add('screen-heading');
  try {
    h.focus({ preventScroll: true });
  } catch {
    h.focus();
  }
}

/** Runs in App: title, focus and wake lock for each screen. */
export function useShell(): void {
  const r = route.value;
  const arg = routeArg.value;
  const first = useRef(true);
  useEffect(() => {
    document.title = screenTitle(r);
    let live = true;
    if (PUZZLE_SCREENS.has(r) && arg)
      void getProject(arg)
        .then((p) => {
          if (live && p) document.title = screenTitle(r, p.name);
        })
        .catch(() => {});
    // Not on the first screen at launch: the reader starts at the top anyway.
    if (first.current) first.current = false;
    else focusHeading();
    holdAwake('screen', AWAKE_SCREENS.has(r));
    return () => {
      live = false;
    };
  }, [r, arg]);
}

/**
 * At launch with no address (the Home Screen app opens at its start address), reopens the puzzle
 * open last time, if it still exists, with Home one Back step behind it. An address (a deep link, a
 * reload of any screen, `#/` for Home) wins.
 */
export async function reopenLastPuzzle(waitMs = 2000): Promise<void> {
  const h = location.hash;
  if (h && h !== '#') return;
  // Never holds up the first screen for long: past waitMs, Home shows and the answer is ignored.
  let late = false;
  const moved = () => late || Boolean(location.hash.replace(/^#/, ''));
  const timer = new Promise<void>((res) => setTimeout(() => ((late = true), res()), waitMs));
  await Promise.race([timer, reopen(moved)]);
}

async function reopen(moved: () => boolean): Promise<void> {
  try {
    const id = await getCurrentProjectId();
    if (!id || moved()) return;
    const p = await getProject(id);
    if (!p || moved()) return;
    history.replaceState(history.state, '', hashFor('home'));
    history.pushState(null, '', hashFor('puzzle', p.id));
    route.value = 'puzzle';
    routeArg.value = p.id;
    logInfo('app', `Reopened the last puzzle: ${p.name}`);
  } catch (err) {
    logWarn('app', 'The last puzzle could not be reopened', err);
  }
}
