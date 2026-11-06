/**
 * The phone's own tilt sensor (PLAN §2 "tilt sensor as backup"): tells how far the phone is from
 * lying flat when no marker is in view (e.g. the middle close-up of a 3 × 3 plan). iOS asks the
 * owner once ("Allow motion & orientation") and only from a tap, so `requestLevelSensor()` must be
 * called from a button handler.
 */
import { signal } from '@preact/signals';
import { logInfo, logWarn } from '../log/logger';

export interface LevelReading {
  /** Angle between the screen's normal and straight down/up (deg); 0 = lying flat. */
  tiltDeg: number;
  /** Which way the phone leans in screen coordinates (unit vector, x right, y down). */
  lean: [number, number];
  at: number;
}

export type LevelPermission = 'unknown' | 'granted' | 'denied' | 'unavailable';

export const levelPermission = signal<LevelPermission>('unknown');
export const level = signal<LevelReading | null>(null);

type OrientationCtor = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Tilt from flat for device orientation angles beta (front-back) and gamma (left-right), in degrees. */
export function tiltFromAngles(betaDeg: number, gammaDeg: number): LevelReading['tiltDeg'] {
  const b = (betaDeg * Math.PI) / 180;
  const g = (gammaDeg * Math.PI) / 180;
  // Screen normal in Earth frame: z component = cos(beta)·cos(gamma).
  const z = Math.cos(b) * Math.cos(g);
  return (Math.acos(Math.min(1, Math.abs(z))) * 180) / Math.PI;
}

function onOrientation(ev: DeviceOrientationEvent): void {
  if (ev.beta == null || ev.gamma == null) return;
  const tiltDeg = tiltFromAngles(ev.beta, ev.gamma);
  const lx = Math.sin((ev.gamma * Math.PI) / 180);
  // Points to the LOW side (gamma > 0: right edge down; beta > 0: top edge up, so the bottom is low).
  const ly = Math.sin((ev.beta * Math.PI) / 180);
  const n = Math.hypot(lx, ly) || 1;
  level.value = { tiltDeg, lean: [lx / n, ly / n], at: performance.now() };
}

let listening = false;

/** Asks for the sensor (from a tap) and starts listening. Safe to call more than once. */
export async function requestLevelSensor(): Promise<LevelPermission> {
  if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
    levelPermission.value = 'unavailable';
    return 'unavailable';
  }
  const ctor = DeviceOrientationEvent as unknown as OrientationCtor;
  try {
    if (typeof ctor.requestPermission === 'function') {
      const answer = await ctor.requestPermission();
      if (answer !== 'granted') {
        levelPermission.value = 'denied';
        logWarn('level', 'Motion & orientation access was declined');
        return 'denied';
      }
    }
  } catch (err) {
    levelPermission.value = 'denied';
    logWarn('level', 'Motion & orientation access failed', err);
    return 'denied';
  }
  if (!listening) {
    addEventListener('deviceorientation', onOrientation);
    listening = true;
    logInfo('level', 'Tilt sensor on');
  }
  levelPermission.value = 'granted';
  return 'granted';
}

export function stopLevelSensor(): void {
  if (!listening) return;
  removeEventListener('deviceorientation', onOrientation);
  listening = false;
  level.value = null;
}
