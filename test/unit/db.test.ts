/**
 * The app database (src/db/db.ts) on an in-memory IndexedDB (fake-indexeddb).
 *
 * Three guarantees (PLAN §4 "Every schema change…"):
 * 1. Every table can be written and read back.
 * 2. SCHEMA SNAPSHOT: no existing schema version is ever edited (test/unit/__schema__/schema-history.json).
 * 3. UPGRADE PATH: a database created at ANY historical version opens with today's PuzzleLensDB
 *    and keeps all its rows. The harness is generic: when version N+1 is added, it is tested
 *    automatically from every older version.
 */
import 'fake-indexeddb/auto'; // must come first: Dexie picks up indexedDB when it loads
import { readFileSync } from 'node:fs';
import Dexie, { type IndexableType } from 'dexie';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, db, eraseAllData, PuzzleLensDB, SCHEMA_HISTORY } from '../../src/db/db';

const SNAPSHOT_PATH = 'test/unit/__schema__/schema-history.json';
const snapshot = JSON.parse(readFileSync(new URL('./__schema__/schema-history.json', import.meta.url), 'utf8')) as {
  versions: Record<string, Record<string, string>>;
};

const RULE =
  'RULE (src/db/db.ts): never edit an existing schema version — people\'s catalogs are stored in it. ' +
  'Instead add `this.version(N + 1).stores({...}).upgrade(...)` to PuzzleLensDB, add N + 1 to SCHEMA_HISTORY, ' +
  `then append N + 1 to ${SNAPSHOT_PATH}.`;

let dbCounter = 0;
const uniqueName = (prefix: string) => `${prefix}-${Date.now()}-${++dbCounter}`;

const versions = Object.keys(SCHEMA_HISTORY)
  .map(Number)
  .sort((a, b) => a - b);

/** Dexie store spec → canonical form (primary key first, then indexes sorted; whitespace-free). */
function canonical(stores: Record<string, string | null>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const table of Object.keys(stores).sort()) {
    const spec = stores[table];
    if (spec === null || spec === undefined) {
      out[table] = null;
      continue;
    }
    const [pk = '', ...idx] = spec.split(',').map((s) => s.trim());
    out[table] = [pk, ...idx.filter(Boolean).sort()].join(',');
  }
  return out;
}

describe('schema snapshot (frozen versions)', () => {
  it('versions are numbered 1…N without gaps', () => {
    expect(versions[0]).toBe(1);
    versions.forEach((v, i) => expect(v, `version list ${versions.join(',')}`).toBe(i + 1));
  });

  it('no version recorded in the snapshot has been changed or removed', () => {
    for (const [v, frozen] of Object.entries(snapshot.versions)) {
      const now = SCHEMA_HISTORY[Number(v)];
      expect(now, `Schema version ${v} was REMOVED from SCHEMA_HISTORY. ${RULE}`).toBeDefined();
      expect(
        canonical(now!),
        `Schema version ${v} in src/db/db.ts no longer matches ${SNAPSHOT_PATH}. ${RULE}`,
      ).toEqual(canonical(frozen));
    }
  });

  it('every version in SCHEMA_HISTORY is recorded in the snapshot', () => {
    const missing = versions.filter((v) => !(String(v) in snapshot.versions));
    expect(
      missing,
      `New schema version(s) ${missing.join(', ')}: once the upgrade test passes, append them (unchanged) to ${SNAPSHOT_PATH}.`,
    ).toEqual([]);
  });

  it('CURRENT_SCHEMA_VERSION is the highest version', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(Math.max(...versions));
  });

  it('PuzzleLensDB declares exactly CURRENT_SCHEMA_VERSION and opens with the tables of SCHEMA_HISTORY', async () => {
    const d = new PuzzleLensDB(uniqueName('decl'));
    expect(d.verno).toBe(CURRENT_SCHEMA_VERSION);
    await d.open();
    try {
      expect(d.verno).toBe(CURRENT_SCHEMA_VERSION);
      const live = d.tables.map((t) => t.name).sort();
      const expected = Object.entries(SCHEMA_HISTORY[CURRENT_SCHEMA_VERSION]!)
        .filter(([, spec]) => spec !== null)
        .map(([name]) => name)
        .sort();
      expect(live).toEqual(expected);
      for (const t of d.tables) {
        const [pk] = SCHEMA_HISTORY[CURRENT_SCHEMA_VERSION]![t.name]!.split(',');
        expect(t.schema.primKey.src, `primary key of ${t.name}`).toBe(pk!.trim());
      }
    } finally {
      d.close();
    }
  });
});

describe('every table can be written and read', () => {
  it('projects, settings, logs, deviceChecks, launches, blobs, jobs', async () => {
    const d = new PuzzleLensDB(uniqueName('rw'));
    await d.open();
    try {
      await d.projects.put({ id: 'p1', name: 'Seaside 1000', createdAt: 1, updatedAt: 5 });
      await d.projects.put({ id: 'p2', name: 'Cats', createdAt: 2, updatedAt: 3 });
      expect(await d.projects.get('p1')).toEqual({ id: 'p1', name: 'Seaside 1000', createdAt: 1, updatedAt: 5 });
      expect((await d.projects.orderBy('updatedAt').reverse().first())?.id).toBe('p1');

      await d.settings.put({ key: 'units', value: { length: 'mm', nested: [1, 2] } });
      expect((await d.settings.get('units'))?.value).toEqual({ length: 'mm', nested: [1, 2] });
      await d.settings.put({ key: 'units', value: 'cm' });
      expect(await d.settings.count()).toBe(1);

      const id1 = await d.logs.add({ ts: 10, level: 'info', source: 'a', message: 'one' });
      const id2 = await d.logs.add({ ts: 20, level: 'error', source: 'b', message: 'two', data: { x: 1 } });
      expect(id2).toBeGreaterThan(id1);
      expect((await d.logs.where('level').equals('error').toArray()).map((r) => r.message)).toEqual(['two']);
      expect((await d.logs.where('ts').above(15).first())?.data).toEqual({ x: 1 });

      await d.deviceChecks.add({ ts: 1, mode: 'browser', appVersion: '0.1.0', results: { gum: true } });
      await d.deviceChecks.add({ ts: 2, mode: 'standalone', appVersion: '0.1.0', results: { gum: false } });
      expect((await d.deviceChecks.where('mode').equals('standalone').first())?.results).toEqual({ gum: false });

      await d.launches.add({ ts: 100, mode: 'standalone', appVersion: '0.1.0', cameraPermission: 'prompt', previousEndedUnexpectedly: true });
      expect((await d.launches.orderBy('ts').last())?.previousEndedUnexpectedly).toBe(true);

      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
      await d.blobs.put({ id: 'snap-1', ts: 5, kind: 'snap', blob: new Blob([bytes], { type: 'image/jpeg' }), meta: { w: 4032 } });
      const blobRow = await d.blobs.where('kind').equals('snap').first();
      expect(blobRow?.meta).toEqual({ w: 4032 });
      expect(blobRow?.blob.type).toBe('image/jpeg');
      expect(new Uint8Array(await blobRow!.blob.arrayBuffer())).toEqual(bytes);

      await d.jobs.add({ kind: 'rescore', status: 'pending', createdAt: 1, payload: { from: 0 } });
      await d.jobs.add({ kind: 'report', status: 'done', createdAt: 2 });
      const pending = await d.jobs.where('status').equals('pending').toArray();
      expect(pending.map((j) => j.kind)).toEqual(['rescore']);
      await d.jobs.update(pending[0]!.id!, { status: 'running' });
      expect(await d.jobs.where('status').equals('running').count()).toBe(1);
    } finally {
      d.close();
    }
  });

  it('db() is a shared instance and eraseAllData() wipes everything', async () => {
    const a = db();
    expect(db()).toBe(a);
    await a.settings.put({ key: 'k', value: 1 });
    expect(await db().settings.count()).toBe(1);
    await eraseAllData();
    const b = db();
    expect(b).not.toBe(a);
    expect(await b.settings.count()).toBe(0);
    b.close();
  });
});

// ---------------------------------------------------------------------------------------------
// Upgrade-path harness
// ---------------------------------------------------------------------------------------------

interface KeySpec {
  fields: string[];
  auto: boolean;
  multi: boolean;
}

function parseKey(src: string): KeySpec {
  let s = src.trim();
  const auto = s.startsWith('++');
  s = s.replace(/^(\+\+|&|\*)/, '');
  const multi = src.trim().startsWith('*');
  const fields = s.startsWith('[') ? s.slice(1, -1).split('+').map((f) => f.trim()) : s ? [s] : [];
  return { fields, auto, multi };
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = (o[p] ??= {}) as Record<string, unknown>;
  o[parts.at(-1)!] = value;
}

/**
 * Sample rows for one table at one schema version, derived from its store spec, so new tables
 * and indexes are covered automatically. Every row carries a unique `__sample` tag.
 */
function sampleRows(table: string, spec: string, version: number, n = 3): { rows: Record<string, unknown>[]; keys?: string[] } {
  const [pkSrc = '', ...idxSrc] = spec.split(',');
  const pk = parseKey(pkSrc);
  const rows: Record<string, unknown>[] = [];
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    const row: Record<string, unknown> = {
      __sample: `v${version}:${table}:${i}`,
      payload: { i, text: `sample ${i} ✓`, list: [i, i + 1], bytes: new Uint8Array([i, 255 - i]) },
    };
    for (const s of idxSrc) {
      const k = parseKey(s);
      for (const f of k.fields) setPath(row, f, k.multi ? [`${f}-${i}`, `${f}-common`] : i % 2 ? i * 1000 + 7 : `${f}-${i}`);
    }
    if (pk.fields.length && !pk.auto) for (const f of pk.fields) setPath(row, f, `${table}-${f}-${version}-${i}`);
    if (!pk.fields.length && !pk.auto) keys.push(`${table}-outbound-${i}`);
    rows.push(row);
  }
  return keys.length ? { rows, keys } : { rows };
}

/**
 * What a row written at `from` should look like after upgrading to today's version.
 * Today (only version 1) every row is unchanged. When an upgrade function transforms rows
 * (renames a field, moves data to a new table…), describe the expected result here.
 * Return null if the row is intentionally dropped.
 */
function expectedAfterUpgrade(table: string, row: Record<string, unknown>, from: number): Record<string, unknown> | null {
  void table;
  void from;
  return row;
}

/** Creates a database exactly at schema version `v` (plain Dexie, no app code) with sample rows. */
async function createAtVersion(name: string, v: number) {
  const stores = SCHEMA_HISTORY[v]!;
  const old = new Dexie(name);
  old.version(v).stores(stores);
  await old.open();
  const written: Record<string, { rows: Record<string, unknown>[]; keys: IndexableType[] }> = {};
  try {
    for (const [table, spec] of Object.entries(stores)) {
      if (spec === null) continue;
      const { rows, keys } = sampleRows(table, spec, v);
      if (keys) await old.table(table).bulkAdd(rows, keys);
      else await old.table(table).bulkAdd(rows);
      // Read back, so auto-generated keys are part of what must survive.
      written[table] = { rows: await old.table(table).toArray(), keys: await old.table(table).toCollection().primaryKeys() };
    }
  } finally {
    old.close();
  }
  return written;
}

const bySample = (a: Record<string, unknown>, b: Record<string, unknown>) => String(a.__sample).localeCompare(String(b.__sample));

describe('upgrade path: a database from every past version opens with today\'s app without losing rows', () => {
  for (const v of versions) {
    it(`from version ${v} → ${CURRENT_SCHEMA_VERSION}`, async () => {
      const name = uniqueName(`upgrade-from-${v}`);
      const written = await createAtVersion(name, v);
      expect(Object.keys(written).length).toBeGreaterThan(0);

      const d = new PuzzleLensDB(name);
      await d.open();
      try {
        expect(d.verno).toBe(CURRENT_SCHEMA_VERSION);
        const currentTables = new Set(d.tables.map((t) => t.name));
        for (const [table, { rows, keys }] of Object.entries(written)) {
          const expected = rows.map((r) => expectedAfterUpgrade(table, r, v)).filter((r): r is Record<string, unknown> => r !== null);
          if (!currentTables.has(table)) {
            expect(expected, `table ${table} was dropped after version ${v}, but expectedAfterUpgrade() keeps rows`).toEqual([]);
            continue;
          }
          const got = (await d.table(table).toArray()) as Record<string, unknown>[];
          expect(got.slice().sort(bySample), `rows of ${table} after upgrading from version ${v}`).toEqual(expected.slice().sort(bySample));
          if (expected.length === rows.length) {
            expect(await d.table(table).toCollection().primaryKeys(), `keys of ${table}`).toEqual(keys);
          }
          // Every index of today's schema is usable on upgraded data.
          for (const idx of d.table(table).schema.indexes) {
            await expect(d.table(table).orderBy(idx.name).count(), `index ${table}.${idx.name}`).resolves.toBeGreaterThanOrEqual(0);
          }
        }
        // And the upgraded database accepts new rows in every table.
        for (const t of d.tables) {
          const spec = SCHEMA_HISTORY[CURRENT_SCHEMA_VERSION]![t.name]!;
          const { rows, keys } = sampleRows(t.name, spec, 999, 1);
          await (keys ? t.bulkAdd(rows, keys) : t.bulkAdd(rows));
        }
      } finally {
        d.close();
        await Dexie.delete(name);
      }
    });
  }

  it('a database from a NEWER app version (e.g. after rolling back an update) still opens and its rows are readable', async () => {
    // Dexie 4 opens an existing database whose version is higher than the declared one instead
    // of failing with VersionError. Pin that behaviour: a rollback must not lock people out.
    const name = uniqueName('from-future');
    const future = new Dexie(name);
    future.version(CURRENT_SCHEMA_VERSION + 1).stores({ ...SCHEMA_HISTORY[CURRENT_SCHEMA_VERSION]!, futureTable: '++id, x' });
    await future.open();
    await future.table('settings').put({ key: 'units', value: 'cm' });
    await future.table('futureTable').add({ x: 1 });
    future.close();
    const d = new PuzzleLensDB(name);
    try {
      await d.open();
      expect((await d.settings.get('units'))?.value).toBe('cm');
    } finally {
      d.close();
      await Dexie.delete(name);
    }
  });

  it('the harness itself: sample rows cover every primary-key and index field', () => {
    const { rows, keys } = sampleRows('t', '++id, ts, [project+index], *tags, &code, a.b', 9);
    expect(keys).toBeUndefined();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ ts: 'ts-0', project: 'project-0', index: 'index-0', tags: ['tags-0', 'tags-common'], code: 'code-0', a: { b: 'a.b-0' } });
    expect(rows[0]).not.toHaveProperty('id');
    expect(sampleRows('t', 'id', 1).rows[2]).toMatchObject({ id: 't-id-1-2' });
    expect(sampleRows('t', '[project+index], kind', 2).rows[0]).toMatchObject({ project: 't-project-2-0', index: 't-index-2-0' });
    expect(sampleRows('t', ', kind', 1).keys).toEqual(['t-outbound-0', 't-outbound-1', 't-outbound-2']);
  });
});
