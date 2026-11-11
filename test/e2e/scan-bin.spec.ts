/**
 * Deleting the scanned pieces, restoring them, and "Delete and scan again" on the puzzle screen
 * (owner's request 2026-11-08), in WebKit with a stored puzzle of 3 scanned pieces.
 */
import { test, expect, gotoScreen, openTab } from './fixtures';
import type { Page } from '@playwright/test';

async function seed(page: Page, id: string, n: number): Promise<void> {
  await page.evaluate(
    async ([pid, count]) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces', 'snaps'], 'readwrite');
        tx.objectStore('projects').put({
          id: pid,
          name: 'Bin test',
          createdAt: 1,
          updatedAt: 2,
          pieceCount: 1000,
          grid: { cols: 28, rows: 36, source: 'suggested' },
          box: null,
          markerMap: null,
          tableModel: null,
          piecePitch: { wMm: 17.8, hMm: 19.4, n: count },
          setupStep: 6,
          tracking: 'pieces',
          scaleSource: 'coin',
        });
        for (let i = 0; i < count; i++)
          tx.objectStore('pieces').put({
            id: `pc${i}`,
            projectId: pid,
            createdAt: 1,
            updatedAt: 1,
            status: 'table',
            table: { x: i * 30, y: 0, angleDeg: 0, lastSeen: 1, snapId: 's1' },
            outlineMm: [0, 0, 1, 0, 1, 1],
            areaMm2: 300,
            sizeMm: [18, 19],
            colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
            thumbBlobId: null,
            seen: 1,
            bestPxPerMm: 5,
            flags: {},
          });
        tx.objectStore('snaps').put({
          id: 's1',
          projectId: pid,
          kind: 'overview',
          ts: 1,
          width: 4032,
          height: 3024,
          zoom: 1,
          imgToTable: null,
          quality: null,
          blobId: null,
          pieceIds: [],
        });
        tx.oncomplete = () => res();
      });
      dbh.close();
    },
    [id, n] as const,
  );
}

test.describe('scanned pieces: delete, restore, scan again', () => {
  test.use({ persistentStorage: true });

  test('delete moves the pieces to the bin; restore brings them and the coin size back', async ({ page }) => {
    await gotoScreen(page, '');
    await seed(page, 'e2e-bin', 3);
    // M9 part 4: the pieces read are on the Pieces tab; the size, the scanned pieces and the bin on More.
    await page.evaluate(() => (location.hash = '#/puzzle/e2e-bin/pieces'));
    await expect(page.getByTestId('puzzle-pieces')).toContainText('3');
    await openTab(page, 'more');
    await expect(page.getByTestId('puzzle-size')).toContainText('measured with your coin');
    await expect(page.getByTestId('scan-bin')).toHaveCount(0);

    await page.getByTestId('delete-scan').click();
    await expect(page.getByTestId('delete-scan-confirm')).toContainText('3 pieces');
    await page.getByTestId('delete-scan-yes').click();
    await expect(page.getByTestId('scan-bin-note')).toContainText('3 pieces moved to the bin');
    await expect(page.getByTestId('puzzle-size')).toHaveCount(0);
    await expect(page.getByTestId('scan-bin')).toContainText('3 pieces and 1 photo ');
    await expect(page.getByTestId('delete-scan')).toHaveCount(0);
    await openTab(page, 'pieces');
    await expect(page.getByTestId('puzzle-pieces')).toContainText('0');
    await openTab(page, 'more');

    // Still there after closing the app (the tab too).
    await page.reload();
    await expect(page.getByTestId('scan-bin')).toContainText('3 pieces');

    await page.getByTestId('restore-scan').click();
    await expect(page.getByTestId('scan-bin-note')).toContainText('3 pieces restored');
    await expect(page.getByTestId('puzzle-size')).toContainText('measured with your coin');
    await expect(page.getByTestId('scan-bin')).toHaveCount(0);
    await openTab(page, 'pieces');
    await expect(page.getByTestId('puzzle-pieces')).toContainText('3');
  });

  test('"Delete and scan again" opens a fresh overview', async ({ page }) => {
    await gotoScreen(page, '');
    await seed(page, 'e2e-rescan', 2);
    await page.evaluate(() => (location.hash = '#/puzzle/e2e-rescan/more'));
    await page.getByTestId('delete-scan').click();
    await page.getByTestId('delete-scan-rescan').click();
    await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'overview');
    await page.getByRole('button', { name: /Back/ }).first().click();
    await expect(page.getByTestId('puzzle-screen')).toBeVisible();
    await openTab(page, 'pieces');
    await expect(page.getByTestId('puzzle-pieces')).toContainText('0');
    await openTab(page, 'more');
    await expect(page.getByTestId('scan-bin')).toContainText('2 pieces');
  });
});
