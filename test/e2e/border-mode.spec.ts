/**
 * Border mode on the puzzle screen (M3): pieces read from their outlines into corner (orange),
 * edge (teal), inside and not sure, with counts against the grid. Outlines come from the synthetic
 * generator (a corner, two edges, two inside pieces), plus one touching pair (not sure).
 */
import { test, expect, gotoScreen } from './fixtures';
import { generatePuzzle } from '../synth/index';

const pz = generatePuzzle({ cols: 6, rows: 5, cellMm: [17.8, 19.4], seed: 4 });
const pick = (id: string) => pz.pieces.find((p) => p.id === id)!.outlineMm;
const pieces = [
  { id: 'a', outline: pick('r0c0'), flags: {} }, // corner
  { id: 'b', outline: pick('r0c2'), flags: {} }, // edge
  { id: 'c', outline: pick('r2c0'), flags: {} }, // edge
  { id: 'd', outline: pick('r2c2'), flags: {} }, // inside
  { id: 'e', outline: pick('r3c3'), flags: {} }, // inside
  { id: 'f', outline: pick('r1c1'), flags: { clump: true } }, // touching: not sure
];

test('Border mode groups pieces by shape and counts them against the grid', async ({ page }) => {
  await gotoScreen(page, '');
  await page.evaluate(async (ps) => {
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    await new Promise<void>((res) => {
      const tx = dbh.transaction(['projects', 'pieces'], 'readwrite');
      tx.objectStore('projects').put({
        id: 'e2e-border',
        name: 'Border test',
        createdAt: 1,
        updatedAt: 2,
        pieceCount: 1000,
        grid: { cols: 28, rows: 36, source: 'suggested' },
        box: null,
        markerMap: null,
        tableModel: null,
        piecePitch: { wMm: 17.8, hMm: 19.4, n: 6 },
        setupStep: 6,
        tracking: 'pieces',
        scaleSource: 'coin',
      });
      ps.forEach((p, i) =>
        tx.objectStore('pieces').put({
          id: p.id,
          projectId: 'e2e-border',
          createdAt: 1,
          updatedAt: 1,
          status: 'table',
          table: { x: i * 30, y: 0, angleDeg: 0, lastSeen: 1, snapId: 's1' },
          outlineMm: p.outline,
          areaMm2: 345,
          sizeMm: [18, 19],
          colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
          thumbBlobId: null,
          seen: 1,
          bestPxPerMm: 5,
          flags: p.flags,
        }),
      );
      tx.oncomplete = () => res();
    });
    dbh.close();
  }, pieces);
  await page.evaluate(() => (location.hash = '#/puzzle/e2e-border'));
  await expect(page.getByTestId('group-all')).toContainText('6');
  await expect(page.getByTestId('group-border')).toContainText('3');
  await expect(page.getByTestId('group-interior')).toContainText('2');
  await expect(page.getByTestId('group-unsure')).toContainText('1');
  await page.getByTestId('group-border').click();
  await expect(page.getByTestId('border-counts')).toContainText('Corners 1 of 4');
  await expect(page.getByTestId('border-counts')).toContainText('Edges 2 of 120');
  await expect(page.locator('[data-testid="catalog"] [data-group]')).toHaveCount(3);
  await expect(page.locator('[data-testid="catalog"] [data-group]').first()).toHaveAttribute('data-group', 'corner');
  await page.getByTestId('group-unsure').click();
  await expect(page.locator('[data-testid="catalog"] [data-group]')).toHaveCount(1);
  await expect(page.getByTestId('border-warning')).toHaveCount(0);
});
