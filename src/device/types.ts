/**
 * Device check results (PLAN §5/§6 M1, RESEARCH §19, BRIEF §2). One results object is kept per
 * display mode (Safari tab / Home Screen app): every completed run merges its checks into it and
 * saves a new row in db().deviceChecks, so the newest row per mode always holds everything.
 */
import type { DisplayMode } from '../db/db';

export type { DisplayMode };

/**
 * yes = works; no = not available; partial = works with limits; error = the test itself failed;
 * skipped = not run; info = a known iPhone limit or an expected state ("normal on iPhone, nothing to do").
 */
export type CheckStatus = 'yes' | 'no' | 'partial' | 'error' | 'skipped' | 'info';

export type SectionId = 'basics' | 'camera' | 'photos' | 'graphics' | 'storage' | 'other';

/** The four things the user can run on the Device check screen. */
export type RunPart = 'automatic' | 'camera' | 'fileCamera' | 'memory';

export interface CheckEntry {
  /** Stable id (also used as data-testid `check-<id>`). */
  id: string;
  section: SectionId;
  /** Plain-English name. */
  label: string;
  status: CheckStatus;
  /** Short human-readable result. */
  value: string;
  /** Anything useful for the developer (JSON). Shown when the row is tapped, and in reports. */
  details?: unknown;
  /**
   * The app version this row was measured with. Rows are carried forward after an app update, so a
   * row can be older than the results object it sits in (the screen then says so).
   */
  appVersion?: string;
}

export interface DeviceEnvironment {
  userAgent: string;
  platform: string | null;
  vendor: string | null;
  /** "Version/x.y" from the user agent (Safari's own version). */
  safariVersion: string | null;
  /** iOS version as written in the user agent (Safari 26+ may freeze this; treat as a hint). */
  iosVersionInUA: string | null;
  language: string | null;
  screen: { width: number; height: number; availWidth: number; availHeight: number; orientation: string | null };
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  hardwareConcurrency: number | null;
  maxTouchPoints: number | null;
  secureContext: boolean;
  crossOriginIsolated: boolean;
  /** navigator.standalone (iOS-only flag for Home Screen apps). */
  standaloneFlag: boolean | null;
}

export interface DeviceCheckResults {
  schema: 1;
  appVersion: string;
  /** When these results were last changed (ms since epoch). */
  ts: number;
  mode: DisplayMode;
  environment: DeviceEnvironment;
  checks: CheckEntry[];
  /** When each part last completed (ms since epoch). */
  parts: Partial<Record<RunPart, number>>;
}
