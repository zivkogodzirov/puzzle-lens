/**
 * Keeps the screen on while the camera is in use (works in Home Screen apps since iOS 18.4).
 * iOS drops the lock when the app is hidden, so it is re-requested when the app comes back.
 * Safe against quick on/off/on: a request that finishes after the lock stopped being wanted is
 * released straight away, and only one request runs at a time.
 */
import { signal } from '@preact/signals';
import { logWarn } from '../log/logger';

export const wakeLockActive = signal(false);

let sentinel: WakeLockSentinel | null = null;
let pending: Promise<void> | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    const s = await navigator.wakeLock.request('screen');
    if (!wanted || sentinel) {
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
    logWarn('wakelock', 'Could not keep the screen awake', err);
  }
}

function ensure(): void {
  if (!wanted || sentinel || pending) return;
  pending = acquire().finally(() => {
    pending = null;
  });
}

export function keepAwake(on: boolean): void {
  wanted = on;
  if (on) {
    ensure();
  } else if (sentinel) {
    const s = sentinel;
    sentinel = null;
    wakeLockActive.value = false;
    void s.release().catch(() => {});
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') ensure();
});
