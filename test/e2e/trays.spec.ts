/**
 * Trays by colour on the puzzle screen (M4) in WebKit: 9 pieces of 3 colours on the table and one
 * saved overview photo. The pieces are grouped by colour; a group lights up on the photo; it goes
 * into a tray (and stays there after a reload); the labels page has one label per group; the tray
 * goes back on the table.
 */
import { createCanvas } from '@napi-rs/canvas';
import { test, expect, gotoScreen, openTab } from './fixtures';

const S = 56;
const COLOURS: Array<[number, number, number]> = [
  [30, 30, 70], // navy: the darkest, group A
  [200, 40, 40], // red
  [230, 210, 80], // yellow
];

/** A straightened piece of one colour (a disc; outside it isn't piece). */
function patch(rgb: [number, number, number]): string {
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if ((x - S / 2) ** 2 + (y - S / 2) ** 2 > (S * 0.45) ** 2) continue;
      out.set([...rgb, 255], (y * S + x) * 4);
    }
  return Buffer.from(out).toString('base64');
}

/** The overview photo: 600 × 400 px of a 300 × 200 mm table, a square per piece in its colour. */
function photo(pieces: Array<{ x: number; y: number; c: number }>): string {
  const c = createCanvas(600, 400);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#eee';
  ctx.fillRect(0, 0, 600, 400);
  for (const p of pieces) {
    ctx.fillStyle = `rgb(${COLOURS[p.c]!.join(',')})`;
    ctx.fillRect((p.x - 9) * 2, (p.y - 9) * 2, 36, 36);
  }
  return c.encodeSync('jpeg', 90).toString('base64');
}

test.setTimeout(120_000);
test.use({ persistentStorage: true });

test('pieces are grouped by colour, light up on the photo, go into a tray and back; labels to print', async ({ page }) => {
  const pieces = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, x: 30 + (i % 3) * 100 + (i % 2) * 10, y: 40 + Math.floor(i / 3) * 60, c: i % 3 }));
  await gotoScreen(page, '');
  const seeded = await page.evaluate(
    async ([ps, patches, jpg]) => {
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces', 'blobs', 'snaps'], 'readwrite');
        tx.objectStore('blobs').put({ id: 'e2e-trays:scan-s1', ts: 1, kind: 'scan', blob: new Blob([bytes(jpg)], { type: 'image/jpeg' }) });
        tx.objectStore('snaps').put({
          id: 's1',
          projectId: 'e2e-trays',
          kind: 'overview',
          // The patches' time: their light is measured from this photo (pieces scanned before it was measured during scans).
          ts: 5,
          width: 600,
          height: 400,
          zoom: 1,
          imgToTable: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 1],
          quality: null,
          blobId: 'e2e-trays:scan-s1',
          pieceIds: ps.map((p) => p.id),
        });
        tx.objectStore('projects').put({
          id: 'e2e-trays',
          name: 'Trays test',
          createdAt: 1,
          updatedAt: 2,
          pieceCount: 80,
          grid: { cols: 10, rows: 8, source: 'suggested' },
          box: null,
          markerMap: null,
          tableModel: null,
          piecePitch: { wMm: 18, hMm: 18, n: 9 },
          setupStep: 6,
          tracking: 'pieces',
          scaleSource: 'coin',
        });
        ps.forEach((p) => {
          tx.objectStore('blobs').put({ id: `e2e-trays:patch-${p.id}`, ts: 1, kind: 'patch', blob: new Blob([bytes(patches[p.c]!)]) });
          tx.objectStore('pieces').put({
            id: p.id,
            projectId: 'e2e-trays',
            createdAt: 1,
            updatedAt: 1,
            status: 'table',
            table: { x: p.x, y: p.y, angleDeg: 0, lastSeen: 1, snapId: 's1' },
            outlineMm: [-9, -9, 9, -9, 9, 9, -9, 9],
            areaMm2: 324,
            sizeMm: [18, 18],
            colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
            thumbBlobId: null,
            seen: 1,
            bestPxPerMm: 5,
            flags: {},
            patch: { blobId: `e2e-trays:patch-${p.id}`, flats: [false, false, false, false], sure: true, ts: 5 },
          });
        });
        tx.oncomplete = () => res();
      });
      dbh.close();
      return 'ok';
    },
    [pieces, COLOURS.map(patch), photo(pieces)] as const,
  );
  expect(seeded).toBe('ok');
  await page.evaluate(() => (location.hash = '#/puzzle/e2e-trays/pieces'));

  // The table view: every piece on the photo, outlined by its state (no box picture: none placed); tap one.
  // M9 part 4: the progress line is on the Pieces tab, "Show my table" on the Table tab.
  await expect(page.getByTestId('progress')).toContainText('9 found');
  await expect(page.getByTestId('progress')).toContainText('0 placed on box');
  await openTab(page, 'table');
  await page.getByTestId('table-toggle').click();
  await expect(page.getByTestId('table-photo-svg').locator('.lit-outline')).toHaveCount(9);
  // Every outline on a dark halo, 2.4 × its width, that taps go through (M9 part 1).
  const halos = page.getByTestId('table-photo-svg').locator('.outline-halo');
  await expect(halos).toHaveCount(9);
  expect(await halos.first().evaluate((el) => [el.getAttribute('stroke'), el.getAttribute('stroke-width'), getComputedStyle(el).pointerEvents])).toEqual([
    'rgba(0, 0, 0, 0.6)',
    '9.6',
    'none',
  ]);
  await page.getByTestId('table-photo-svg').locator('.lit-outline').first().click();
  await expect(page.getByTestId('table-photo-info')).toBeVisible();
  await page.getByTestId('table-photo-pick').click();
  // The full-screen photo closes (M9 part 4: the Table tab's own photo stays in the tab).
  await expect(page.locator('.photo-result.table-photo')).toHaveCount(0);
  await expect(page.getByTestId('piece-spots')).toBeVisible();
  // Its card is a sheet over the page (M9 part 3): closed before the page goes on.
  await page.getByTestId('spot-close').click();
  await expect(page.getByTestId('spot')).toHaveCount(0);
  await openTab(page, 'pieces');

  // Three colours, three groups (6 trays asked for, but only 3 colours): the darkest is A.
  await page.getByTestId('trays-toggle').click();
  await expect(page.getByTestId('tray-groups').locator('button')).toHaveCount(3);
  await expect(page.getByTestId('tray-group-A')).toContainText('A 3');
  await expect(page.getByTestId('tray-uneven')).toHaveCount(0);
  await expect(page.getByTestId('tray-count-value')).toHaveText('6');
  await expect(page.getByTestId('tray-few-colours')).toContainText('Only 3 different colours');
  await page.getByTestId('tray-group-A').click();
  await expect(page.getByTestId('tray-detail')).toContainText('3 pieces on the table');
  // The grid below (M9 part 4: on the Sort into trays page) shows only group A, each with its badge.
  await expect(page.getByTestId('catalog').locator('.thumb-btn')).toHaveCount(3);
  await expect(page.getByTestId('tray-tag')).toHaveText(['A', 'A', 'A']);

  // Lit up on the table photo.
  await page.getByTestId('tray-photo').click();
  await expect(page.getByTestId('table-photo-svg').locator('.lit-outline')).toHaveCount(3);
  await expect(page.getByTestId('table-photo')).toContainText('Group A: 3 lit up');
  await page.screenshot({ path: test.info().outputPath('trays-photo.png') });
  await page.getByTestId('table-photo-close').click();

  // Into tray A: off the table, and the groups are fixed.
  await page.getByTestId('tray-move').click();
  await expect(page.getByTestId('tray-note')).toContainText('3 pieces in tray A');
  await expect(page.getByTestId('tray-summary')).toContainText('In trays: A 3');
  await expect(page.getByTestId('tray-count')).toContainText('Fixed while pieces are in trays');
  await expect(page.getByTestId('catalog').locator('.thumb-btn')).toHaveCount(6);
  // The counts on the Pieces tab (Back from the page).
  await page.getByTestId('navbar-back').click();
  await expect(page.getByTestId('puzzle-status-counts')).toContainText('6 on the table, 3 in trays');

  // Still so after closing and opening the app (on the same tab).
  await page.reload();
  await expect(page.getByTestId('tab-pieces')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('trays-toggle').click();
  await expect(page.getByTestId('tray-group-A')).toContainText('3 in tray');
  await expect(page.getByTestId('tray-summary')).toContainText('In trays: A 3');
  await page.screenshot({ path: test.info().outputPath('trays-panel.png'), fullPage: true });

  // Labels: one per group.
  await page.getByTestId('print-tray-labels').click();
  await expect(page.getByTestId('tray-labels')).toBeVisible();
  await expect(page.locator('[data-testid^="tray-label-"]')).toHaveCount(3);
  await expect(page.getByTestId('tray-label-A')).toContainText('Tray A');
  await expect(page.getByTestId('print-labels')).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('trays-labels.png'), fullPage: true });

  // Back on the table (from the labels, back to the Sort into trays page: M9 part 4).
  await page.getByTestId('labels-back').click();
  await expect(page.getByTestId('sort-page')).toBeVisible();
  await page.getByTestId('tray-back-A').click();
  await expect(page.getByTestId('tray-note')).toContainText('Tray A: 3 pieces back on the table');
  await expect(page.getByTestId('tray-summary')).toHaveCount(0);
  await expect(page.getByTestId('tray-count')).not.toContainText('Fixed');
  await expect(page.getByTestId('tray-count-value')).toHaveText('6');
  await expect(page.getByTestId('catalog').locator('.thumb-btn')).toHaveCount(9);
});
