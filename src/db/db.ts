/**
 * The app's database (IndexedDB via Dexie), PLAN §4.
 *
 * RULE: never edit an existing version's schema. To change the layout, add
 * `this.version(N + 1).stores({...}).upgrade(...)`, append N + 1 to SCHEMA_HISTORY, and add an
 * upgrade test (test/unit/db.test.ts). The schema snapshot test fails if an old version changes,
 * so an app update can never silently wipe someone's catalog.
 */
import Dexie, { type Table } from 'dexie';
import type { PieceRow, Project, SnapRow } from '../project/types';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogRow {
  id?: number;
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export type DisplayMode = 'standalone' | 'browser';

export interface DeviceCheckRow {
  id?: number;
  ts: number;
  mode: DisplayMode;
  appVersion: string;
  results: unknown;
}

export interface LaunchRow {
  id?: number;
  ts: number;
  mode: DisplayMode;
  appVersion: string;
  /** Camera permission state at launch ("granted" / "prompt" / "denied" / "unknown"). */
  cameraPermission: string;
  /** The previous visit ended without a normal close (possibly killed by iOS for memory). */
  previousEndedUnexpectedly: boolean;
}

export interface BlobRow {
  id: string;
  ts: number;
  kind: string;
  blob: Blob;
  meta?: unknown;
}

/** A puzzle (M2). Version-1 rows only have id, name and the two times; readers must cope. */
export type ProjectRow = Project;

export interface JobRow {
  id?: number;
  kind: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  createdAt: number;
  payload?: unknown;
}

/** Store definitions per version. Frozen: see the rule at the top of this file. */
export const SCHEMA_HISTORY: Record<number, Record<string, string>> = {
  1: {
    projects: 'id, updatedAt',
    settings: 'key',
    logs: '++id, ts, level',
    deviceChecks: '++id, ts, mode',
    launches: '++id, ts',
    blobs: 'id, ts, kind',
    jobs: '++id, kind, status',
  },
  2: {
    projects: 'id, updatedAt',
    settings: 'key',
    logs: '++id, ts, level',
    deviceChecks: '++id, ts, mode',
    launches: '++id, ts',
    blobs: 'id, ts, kind',
    jobs: '++id, kind, status',
    pieces: 'id, projectId, [projectId+status]',
    snaps: 'id, projectId, [projectId+kind], ts',
  },
};

export const CURRENT_SCHEMA_VERSION = 2;

export class PuzzleLensDB extends Dexie {
  projects!: Table<ProjectRow, string>;
  settings!: Table<SettingRow, string>;
  logs!: Table<LogRow, number>;
  deviceChecks!: Table<DeviceCheckRow, number>;
  launches!: Table<LaunchRow, number>;
  blobs!: Table<BlobRow, string>;
  jobs!: Table<JobRow, number>;
  pieces!: Table<PieceRow, string>;
  snaps!: Table<SnapRow, string>;

  constructor(name = 'puzzle-lens') {
    super(name);
    this.version(1).stores(SCHEMA_HISTORY[1]!);
    // v2 (M2): pieces and snaps. Projects stored by v1 (none were created in M1) get the new fields.
    this.version(2)
      .stores(SCHEMA_HISTORY[2]!)
      .upgrade((tx) =>
        tx
          .table('projects')
          .toCollection()
          .modify((p: Partial<Project>) => {
            p.pieceCount ??= 0;
            p.grid ??= null;
            p.box ??= null;
            p.markerMap ??= null;
            p.tableModel ??= null;
            p.piecePitch ??= null;
            p.setupStep ??= 0;
          }),
      );
  }
}

let instance: PuzzleLensDB | null = null;

export function db(): PuzzleLensDB {
  instance ??= new PuzzleLensDB();
  return instance;
}

/** Deletes everything (Settings → "Erase all data"). */
export async function eraseAllData(): Promise<void> {
  const d = db();
  d.close();
  await Dexie.delete(d.name);
  instance = null;
}
