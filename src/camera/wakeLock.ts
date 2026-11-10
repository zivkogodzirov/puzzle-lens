/**
 * Keeps the screen on while the camera is in use or a puzzle screen is open (works in Home Screen
 * apps since iOS 18.4). Several parts can want it at once (`holdAwake`); it is held while any does.
 * iOS drops the lock when the app is hidden, so it is given back then and re-requested when the app
 * comes back. Safe against quick on/off/on: a request that finishes after the lock stopped being
 * wanted is released straight away, and only one request runs at a time.
 */
import { signal } from '@preact/signals';
import { logWarn } from '../log/logger';

export const wakeLockActive = signal(false);

let sentinel: WakeLockSentinel | null = null;
let pending: Promise<void> | null = null;
/** Who wants the screen kept on (the camera, an open puzzle screen). */
const holders = new Set<string>();
/** Logged once: the same refusal on every puzzle screen would fill the activity log. */
let warned = false;

const wanted = () => holders.size > 0;

async function acquire(): Promise<void> {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    const s = await navigator.wakeLock.request('screen');
    if (!wanted() || sentinel) {
      // Stopped wanting it while asking (or another lock is already held): give it back.
      void s.release().catch(() => {});
      return;
    }
    sentinel = s;
    wakeLockActive.value = true;
    s.addEventListener('release', () => {
      if (sentinel !== s) return; // an old lock's late event
      sentinel = null;
      wakeLockActive.value = false;
    });
  } catch (err) {
    if (!warned) logWarn('wakelock', 'Could not keep the screen awake', err);
    warned = true;
  }
}

function ensure(): void {
  if (!wanted() || sentinel || pending) return;
  pending = acquire().finally(() => {
    pending = null;
  });
}

function release(): void {
  if (!sentinel) return;
  const s = sentinel;
  sentinel = null;
  wakeLockActive.value = false;
  void s.release().catch(() => {});
}

/**
 * Keeps the screen on while `who` wants it (M9 part 1: open puzzle screens hold it as well as the
 * camera, so the camera turning off doesn't let the screen sleep on the puzzle page).
 */
export function holdAwake(who: string, on: boolean): void {
  if (on) holders.add(who);
  else holders.delete(who);
  if (wanted()) ensure();
  else release();
}

/** The camera's hold: on while it runs. */
export function keepAwake(on: boolean): void {
  holdAwake('camera', on);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') ensure();
  else release();
});
