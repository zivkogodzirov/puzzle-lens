/**
 * Facts about how the app is running: Home Screen app or Safari tab, whether the previous visit
 * ended abruptly (iOS kills pages that use too much memory), camera permission at launch.
 */
import { signal } from '@preact/signals';
import { db, type DisplayMode } from '../db/db';
import { logInfo, logWarn } from '../log/logger';

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export function displayMode(): DisplayMode {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? 'standalone' : 'browser';
}

export const isStandalone = signal(displayMode() === 'standalone');
export const previousEndedUnexpectedly = signal(false);

const ALIVE_KEY = 'puzzle-lens.alive';

export async function cameraPermissionState(): Promise<string> {
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    return status?.state ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Records this launch; detects whether the previous one ended while the app was ON SCREEN.
 * The marker is '1' only while the app is visible. iOS doesn't fire pagehide when you switch apps,
 * and it often reloads a backgrounded app later — that ordinary reload must not count as a crash,
 * so the marker is cleared whenever the app is hidden. What remains is a kill while in use: the
 * memory case.
 */
export async function recordLaunch(): Promise<void> {
  let crashed = false;
  try {
    crashed = sessionStorage.getItem(ALIVE_KEY) === '1';
    const mark = (alive: boolean) => {
      try {
        sessionStorage.setItem(ALIVE_KEY, alive ? '1' : '0');
      } catch {
        /* ignore */
      }
    };
    mark(document.visibilityState === 'visible');
    addEventListener('pagehide', () => mark(false));
    addEventListener('pageshow', () => mark(document.visibilityState === 'visible'));
    document.addEventListener('visibilitychange', () => mark(document.visibilityState === 'visible'));
  } catch {
    /* private mode etc. */
  }
  previousEndedUnexpectedly.value = crashed;
  if (crashed) logWarn('app', 'The previous visit ended while the app was on screen (iOS may have closed it for using too much memory).');
  const permission = await cameraPermissionState();
  try {
    await db().launches.add({ ts: Date.now(), mode: displayMode(), appVersion: APP_VERSION, cameraPermission: permission, previousEndedUnexpectedly: crashed });
  } catch {
    /* ignore */
  }
  logInfo('app', `Puzzle Lens ${APP_VERSION} started (${displayMode()}, camera permission: ${permission})`);
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => (isStandalone.value = displayMode() === 'standalone'));
}

/** Asks the browser to keep our data (granted more readily for Home Screen apps). */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
