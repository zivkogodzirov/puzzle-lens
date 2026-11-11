/**
 * User settings, kept in the database and exposed as signals so screens update automatically.
 */
import { signal, effect, type Signal } from '@preact/signals';
import { db } from '../db/db';

export type Units = 'mm' | 'cm' | 'in';
/** Live camera format (PLAN §3.1 camera contract). */
export type LiveFormat = 'auto-4x3' | '4k' | '1080p';

export interface Settings {
  units: Units;
  liveFormat: LiveFormat;
  /** Frames per second the tracker analyses (battery vs smoothness). */
  trackingFps: 30 | 15;
  /** The performance display on the Live camera screen (shown only in Tester mode; off by default since M9 part 1). */
  showHud: boolean;
  /**
   * Tester mode (M9 part 1, design plan §2.8): on, the app shows its testing tools (the 🧪 test steps,
   * Device check, Send report, Activity log, the Live camera screen with its performance display) and
   * developer numbers (tracking speed "/s", the gauge's height and tilt). Off, a cleaner look; nothing
   * else changes. On by default while the owner tests each milestone.
   */
  testerMode: boolean;
  /** Preferred camera deviceId (empty = automatic: the physical "Back Camera"). */
  cameraDeviceId: string;
  /**
   * How Snap takes its picture, chosen by the Device check "Photo test" (JSON of SnapMethod in
   * src/camera/snapMethod.ts); empty = automatic (try the photo pipeline, then the full-size live picture).
   */
  snapMethod: string;
  /**
   * Scan mode (PLAN §5 Settings, M5 part 4): 'full' = an overview, then close-ups (2×) for the
   * shapes; 'quick' = one overview photo (pieces found, coloured and placed; corner and edge marks
   * provisional), no switch to close-ups.
   */
  scanMode: 'full' | 'quick';
  /** The one-time tip on the outlines' labels ("17·9" means column 17, row 9) was shown (M9 part 3). */
  labelTipShown: boolean;
  /** The shutter's flash, sound and haptic tick on the scan camera (M9 part 5, design plan §3.4 "Feedback"). */
  soundsAndTaps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  units: 'mm',
  liveFormat: 'auto-4x3',
  trackingFps: 30,
  showHud: false,
  testerMode: true,
  cameraDeviceId: '',
  snapMethod: '',
  scanMode: 'full',
  labelTipShown: false,
  soundsAndTaps: true,
};

type SettingSignals = { [K in keyof Settings]: Signal<Settings[K]> };

export const settings: SettingSignals = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([k, v]) => [k, signal(v)])) as unknown as SettingSignals;

let loaded = false;

export async function loadSettings(): Promise<void> {
  try {
    const rows = await db().settings.toArray();
    for (const row of rows) {
      const key = row.key as keyof Settings;
      if (key in settings) (settings[key] as Signal<unknown>).value = row.value;
    }
  } catch {
    /* defaults stay */
  }
  loaded = true;
  // Save every later change.
  for (const key of Object.keys(settings) as (keyof Settings)[]) {
    let first = true;
    effect(() => {
      const value = settings[key].value;
      if (first) {
        first = false;
        return;
      }
      if (loaded)
        void db()
          .settings.put({ key, value })
          .catch(() => {});
    });
  }
}

export function settingsSnapshot(): Settings {
  return Object.fromEntries(Object.entries(settings).map(([k, s]) => [k, (s as Signal<unknown>).value])) as unknown as Settings;
}

/** Formats a length given in millimetres in the user's chosen unit. */
export function formatLength(mm: number, units: Units = settings.units.value): string {
  if (units === 'cm') return `${(mm / 10).toFixed(1)} cm`;
  if (units === 'in') return `${(mm / 25.4).toFixed(2)} in`;
  return `${Math.round(mm)} mm`;
}
