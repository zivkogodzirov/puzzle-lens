/**
 * Backup on a 1000-piece puzzle (M7 part 3, PLAN §8 "Backup / report preparation for a 1000-piece
 * project: measured in M7"), in WebKit: a puzzle with 1000 pieces (thumbnail ~12 KB and
 * straightened piece 12.5 KB each, all with placements and answers), a 1 MB box picture and the
 * 10 full-size scan photos the app keeps (4 MB each). Export backup (packed in the helper worker),
 * download, then import it on the home screen (as a copy). Times and size go to the test output.
 */
import { writeFileSync } from 'node:fs';
import { test, expect, gotoScreen } from './fixtures';

test.use({ persistentStorage: true });
test.setTimeout(600_000);

test('1000-piece puzzle: backup prepared, downloaded and imported back, in reasonable time', async ({ page }) => {
  await gotoScreen(page, '');
  const id = 'e2e-1000';
  const seeded = await page.evaluate(async (pid) => {
    let s = 12345;
    const fill = (n: number) => {
      const a = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        s = (s * 1103515245 + 12345) >>> 0;
        a[i] = s >>> 24;
      }
      return a;
    };
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    const put = (stores: string[], f: (tx: IDBTransaction) => void) =>
      new Promise<void>((res, rej) => {
        const tx = dbh.transaction(stores, 'readwrite');
        f(tx);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    const byPiece: Record<string, unknown> = {};
    const answers: unknown[] = [];
    for (let k = 0; k < 1000; k += 100) {
      await put(['pieces', 'blobs'], (tx) => {
        for (let i = k; i < k + 100; i++) {
          const id = `piece-${i}`;
          tx.objectStore('blobs').put({ id: `p:${pid}:thumb-${id}`, ts: 1, kind: 'thumb', blob: new Blob([fill(12_000)], { type: 'image/jpeg' }) });
          tx.objectStore('blobs').put({ id: `p:${pid}:patch-${id}`, ts: 1, kind: 'patch', blob: new Blob([fill(12_544)]) });
          tx.objectStore('pieces').put({
            id,
            projectId: pid,
            createdAt: 1,
            updatedAt: 1,
            status: i < 300 ? 'table' : i < 500 ? 'tray' : i < 900 ? 'placed' : 'aside',
            tray: i >= 300 && i < 500 ? 'A' : null,
            table: { x: (i % 40) * 20, y: Math.floor(i / 40) * 22, angleDeg: 0, lastSeen: 1, snapId: 's0' },
            outlineMm: Array.from({ length: 160 }, (_, j) => Math.round(9 * Math.cos(j) * 10) / 10),
            areaMm2: 345,
            sizeMm: [18, 19],
            colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
            thumbBlobId: `p:${pid}:thumb-${id}`,
            seen: 2,
            bestPxPerMm: 8,
            flags: {},
            patch: {
              blobId: `p:${pid}:patch-${id}`,
              flats: [false, false, false, false],
              sure: true,
              ts: 5,
              sides: 'tbtb',
              sideConf: [1, 1, 1, 1],
              fp: Array.from({ length: 112 }, (_, j) => j % 7),
            },
          });
          byPiece[id] = {
            ts: 5,
            placement: {
              top: [0, 1, 2, 3, 4].map((t) => ({ col: (i + t) % 28, row: Math.floor(i / 28) % 36, rot: 0, score: 0.5, p: 0.2 })),
              verdict: 'several',
            },
          };
          answers.push({
            pieceId: id,
            col: i % 28,
            row: Math.floor(i / 28) % 36,
            rot: 0,
            fits: i % 3 > 0,
            at: 2,
            grid: '28x36',
            verdict: 'likely',
            p: 0.6,
            rank: 0,
            from: 'piece',
            mode: 'whole',
          });
        }
      });
    }
    await put(['blobs', 'snaps'], (tx) => {
      tx.objectStore('blobs').put({ id: `p:${pid}:box`, ts: 1, kind: 'box', blob: new Blob([fill(1_000_000)], { type: 'image/jpeg' }) });
      for (let k = 0; k < 10; k++) {
        tx.objectStore('blobs').put({ id: `p:${pid}:scan-s${k}`, ts: 1, kind: 'snap', blob: new Blob([fill(4_000_000)], { type: 'image/jpeg' }) });
        tx.objectStore('snaps').put({
          id: `s${k}`,
          projectId: pid,
          kind: 'overview',
          ts: k,
          width: 4032,
          height: 3024,
          zoom: 1,
          imgToTable: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          quality: null,
          blobId: `p:${pid}:scan-s${k}`,
          pieceIds: [],
        });
      }
    });
    await put(['projects', 'settings'], (tx) => {
      tx.objectStore('settings').put({ key: `placement:${pid}`, value: { boxKey: `p:${pid}:box|0,0;800,0;800,1000;0,1000|28x36`, colour: null, byPiece } });
      tx.objectStore('projects').put({
        id: pid,
        name: 'A thousand pieces',
        createdAt: 1,
        updatedAt: 2,
        pieceCount: 1000,
        grid: { cols: 28, rows: 36, source: 'suggested' },
        box: {
          photoBlobId: `p:${pid}:box`,
          rectifiedBlobId: `p:${pid}:box`,
          corners: [
            [0, 0],
            [800, 0],
            [800, 1000],
            [0, 1000],
          ],
          photoWidth: 800,
          photoHeight: 1000,
          width: 800,
          height: 1000,
        },
        markerMap: null,
        tableModel: null,
        piecePitch: { wMm: 17.8, hMm: 19.4, n: 300 },
        setupStep: 6,
        tracking: 'pieces',
        answers,
      });
    });
    dbh.close();
    return 'ok';
  }, id);
  expect(seeded).toBe('ok');
  // The backup and its reminder are on the puzzle's More tab (M9 part 4), whose tab shows a dot meanwhile.
  await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}/more`), id);
  await expect(page.getByTestId('tab-more')).toHaveAttribute('aria-label', 'More, backup due');
  // Never backed up, 1000 pieces: reminded (M9 part 4: in the "Back up now" row, which is the reminder's button too).
  await expect(page.getByTestId('backup-reminder')).toContainText('only on this iPhone');
  await expect(page.getByTestId('last-backup')).toContainText('Never backed up');
  const t0 = Date.now();
  await page.getByTestId('export-backup').click();
  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 300_000 });
  const prepareMs = Date.now() - t0;
  const size = await page.getByTestId('export-ready').innerText();
  const dl = page.waitForEvent('download');
  await page.getByTestId('download-backup').click();
  const path = test.info().outputPath('backup.pfbackup');
  await (await dl).saveAs(path);
  // Downloaded: the reminder goes, and the last backup shows.
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);
  await expect(page.getByTestId('tab-more')).not.toHaveAttribute('aria-label', /.+/);
  await expect(page.getByTestId('last-backup')).toContainText('Last backup:');
  await expect(page.getByTestId('last-backup')).toContainText('1000 pieces then');
  // Import it back (a copy, since the puzzle is still here).
  await page.evaluate(() => (location.hash = '#/'));
  const t1 = Date.now();
  await page.getByTestId('import-file').setInputFiles(path);
  await expect(page.getByTestId('import-done')).toBeVisible({ timeout: 300_000 });
  const importMs = Date.now() - t1;
  await expect(page.getByTestId('import-done')).toContainText('copy');
  const copy = await page.evaluate(async () => {
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    const all = await new Promise<Array<{ id: string; name: string }>>((res) => {
      const r = dbh.transaction('projects').objectStore('projects').getAll();
      r.onsuccess = () => res(r.result);
    });
    const c = all.find((p) => p.name.endsWith('(copy)'))!;
    const pieces = await new Promise<number>((res) => {
      const r = dbh.transaction('pieces').objectStore('pieces').index('projectId').count(c.id);
      r.onsuccess = () => res(r.result);
    });
    const placements = await new Promise<{ byPiece: object } | undefined>((res) => {
      const r = dbh.transaction('settings').objectStore('settings').get(`placement:${c.id}`);
      r.onsuccess = () => res(r.result?.value);
    });
    dbh.close();
    return { pieces, placed: Object.keys(placements?.byPiece ?? {}).length };
  });
  expect(copy).toEqual({ pieces: 1000, placed: 1000 });
  const line = `1000-piece backup: prepared in ${(prepareMs / 1000).toFixed(1)} s (${size.replace(/\s+/g, ' ')}), imported in ${(importMs / 1000).toFixed(1)} s`;
  console.log(line);
  writeFileSync(test.info().outputPath('timing.txt'), line);
  expect(prepareMs).toBeLessThan(120_000);
  expect(importMs).toBeLessThan(120_000);
});
