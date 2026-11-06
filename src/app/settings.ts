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
  showHud: boolean;
  /** Preferred camera deviceId (empty = automatic: the physical "Back Camera"). */
  cameraDeviceId: string;
  /**
   * How Snap takes its picture, chosen by the Device check "Photo test" (JSON of SnapMethod in
   * src/camera/snapMethod.ts); empty = automatic (try the photo pipeline, then the full-size live picture).
   */
  snapMethod: string;
}

export const DEFAULT_SETTINGS: Settings = {
  units: 'mm',
  liveFormat: 'auto-4x3',
  trackingFps: 30,
  showHud: true,
  cameraDeviceId: '',
  snapMethod: '',
};

type SettingSignals = { [K in keyof Settings]: Signal<Settings[K]> };

export const settings: SettingSignals = Object.fromEntries(
  Object.entries(DEFAULT_SETTINGS).map(([k, v]) => [k, signal(v)]),
) as unknown as SettingSignals;

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
      if (loaded) void db().settings.put({ key, value }).catch(() => {});
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
