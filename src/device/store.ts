/**
 * Saving and loading Device check results (db().deviceChecks; schema version 1, unchanged).
 * Every completed run adds a row holding the merged results for that display mode, so the newest
 * row per mode is always the full picture (this is what the report picks up).
 */
import { db } from '../db/db';
import { isDeviceCheckResults } from './format';
import type { DeviceCheckResults, DisplayMode } from './types';

export interface SavedCheck {
  id: number;
  results: DeviceCheckResults;
}

export interface DeviceCheckHistory {
  latest: SavedCheck | null;
  byMode: Partial<Record<DisplayMode, SavedCheck>>;
}

export async function loadDeviceCheckHistory(): Promise<DeviceCheckHistory> {
  const out: DeviceCheckHistory = { latest: null, byMode: {} };
  const rows = await db().deviceChecks.orderBy('ts').toArray();
  for (const row of rows) {
    if (row.id == null || !isDeviceCheckResults(row.results)) continue;
    const saved: SavedCheck = { id: row.id, results: row.results };
    out.latest = saved; // rows are in time order: the last valid one wins
    out.byMode[row.results.mode] = saved;
  }
  return out;
}

export async function saveDeviceCheck(results: DeviceCheckResults): Promise<number> {
  return db().deviceChecks.add({ ts: results.ts, mode: results.mode, appVersion: results.appVersion, results });
}
