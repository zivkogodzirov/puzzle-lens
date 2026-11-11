/**
 * The shutter's sound and haptic tick (M9 part 5, design plan §3.4 "Feedback"). Both are off when the
 * "Sounds and taps" setting is off (settings.soundsAndTaps); the white flash is drawn by the scan screen.
 *
 * - Sound: a short two-part click made with Web Audio (no sound file; nothing to download). iPhone Safari
 *   only plays Web Audio after a tap on the page, so `primeFeedback()` (called when the scan screen opens)
 *   wakes it on the first tap there; a photo that takes itself later then has its sound too. The iPhone's
 *   silent switch mutes it, as it does other page sounds.
 * - Haptic tick: iPhone Safari has no vibration call; tapping the label of a hidden
 *   `<input type="checkbox" switch>` makes the system's switch tick (iOS 18 and later). Elsewhere (no
 *   `switch` support) `navigator.vibrate` is used where there is one, else nothing happens.
 * Neither can fail loudly: any error is swallowed (feedback is a nicety).
 */
import { settings } from './settings';

let ctx: AudioContext | null = null;
let click: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC =
    (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  // "ambient": the click plays alongside music or a podcast instead of pausing it, and the silent switch mutes it
  // (Safari 16.4+; review 2026-11-11).
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== 'ambient') session.type = 'ambient';
  } catch {
    /* not settable here */
  }
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** The shutter sound: two short bursts of filtered noise ("click-clack"), 110 ms in all. */
function clickBuffer(c: AudioContext): AudioBuffer {
  if (click && click.sampleRate === c.sampleRate) return click;
  const rate = c.sampleRate;
  const buf = c.createBuffer(1, Math.round(rate * 0.11), rate);
  const d = buf.getChannelData(0);
  // A fixed seed: the same sound every time.
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  let prev = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / rate;
    const a = t < 0.03 ? Math.exp(-t / 0.006) : 0;
    const b = t >= 0.055 ? 0.7 * Math.exp(-(t - 0.055) / 0.009) : 0;
    // A gentle high-pass (difference of noise) for a crisp click rather than a hiss.
    const n = rnd();
    d[i] = (n - 0.6 * prev) * (a + b) * 0.5;
    prev = n;
  }
  click = buf;
  return buf;
}

/** Wakes the sound on the next tap (iPhone Safari needs one). Call when the scan screen opens; returns a clean-up. */
export function primeFeedback(): () => void {
  const wake = () => {
    if (!settings.soundsAndTaps.value) return;
    const c = audio();
    if (c && c.state === 'suspended') void c.resume().catch(() => {});
  };
  addEventListener('pointerdown', wake, { capture: true, passive: true });
  return () => removeEventListener('pointerdown', wake, { capture: true });
}

/** The shutter sound (nothing when "Sounds and taps" is off). */
export function playShutterSound(): void {
  if (!settings.soundsAndTaps.value) return;
  try {
    const c = audio();
    if (!c) return;
    if (c.state === 'suspended') void c.resume().catch(() => {});
    const src = c.createBufferSource();
    src.buffer = clickBuffer(c);
    const gain = c.createGain();
    gain.gain.value = 0.6;
    src.connect(gain).connect(c.destination);
    src.start();
  } catch {
    /* no sound */
  }
}

let tick: HTMLLabelElement | null = null;

/** The `switch` checkbox is known (iPhone Safari 17.4+; its tick is felt from iOS 18). */
export function hapticSupported(): boolean {
  return typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype;
}

/** A light haptic tick (nothing when "Sounds and taps" is off, or where the phone can't). */
export function hapticTick(): void {
  if (!settings.soundsAndTaps.value) return;
  try {
    if (hapticSupported()) {
      if (!tick || !tick.isConnected) {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('switch', '');
        input.id = 'haptic-tick';
        input.tabIndex = -1;
        tick = document.createElement('label');
        tick.htmlFor = input.id;
        tick.className = 'haptic-tick';
        tick.setAttribute('aria-hidden', 'true');
        tick.append(input);
        document.body.append(tick);
      }
      tick.click();
      return;
    }
    navigator.vibrate?.(10);
  } catch {
    /* no tick */
  }
}
