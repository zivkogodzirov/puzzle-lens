/**
 * New puzzle wizard steps 0–4 (PLAN §5) in WebKit with an iPhone screen, plus the Puzzle screen,
 * resume after reload, and backup export → delete → import.
 *
 * The box photo is made here with @napi-rs/canvas: a portrait picture (497 × 699, like a
 * Ravensburger 1000 turned upright) lying slightly turned on a white table, given to the
 * "Choose from Photos" file input.
 */
import { readFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { unzipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { test, expect, gotoScreen } from './fixtures';

test.use({ persistentStorage: true });

function boxPhoto(): Buffer {
  const W = 1600;
  const H = 1200;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f4f2';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2 + 30, H / 2 - 10);
  ctx.rotate((7 * Math.PI) / 180);
  const pw = 497 * 1.45;
  const ph = 699 * 1.45;
  // A colourful "picture": sky, sea, a lighthouse.
  const g = ctx.createLinearGradient(0, -ph / 2, 0, ph / 2);
  g.addColorStop(0, '#3d7fd6');
  g.addColorStop(0.55, '#9fd0f0');
  g.addColorStop(0.56, '#1d5c8a');
  g.addColorStop(1, '#0c2f4a');
  ctx.fillStyle = g;
  ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
  ctx.fillStyle = '#c62828';
  ctx.fillRect(-40, -ph / 4, 80, ph / 2.2);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) ctx.fillRect(-40, -ph / 4 + 40 + i * 90, 80, 30);
  ctx.fillStyle = '#ffd54f';
  ctx.beginPath();
  ctx.arc(pw / 4, -ph / 3, 50, 0, Math.PI * 2);
  ctx.fill();
  return canvas.encodeSync('jpeg', 92);
}

async function expectStep(page: Page, step: number) {
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', String(step), { timeout: 20_000 });
}

/** Reads one setting straight from the app's IndexedDB. */
async function readSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (k) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('puzzle-lens');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction('settings', 'readonly');
          const get = tx.objectStore('settings').get(k);
          get.onsuccess = () => {
            resolve(get.result?.value ?? null);
            req.result.close();
          };
          get.onerror = () => reject(get.error);
        };
      }),
    key,
  );
}

test('new puzzle: steps 0–4, resume after reload, puzzle screen, backup export, delete and import', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await gotoScreen(page, '');
  await expect(page.getByTestId('your-puzzles')).toContainText('No puzzles yet');
  await page.getByTestId('new-puzzle').click();

  // Step 0: in a Safari tab, the Home Screen advice comes first.
  await expectStep(page, 0);
  await expect(page.getByTestId('step-install')).toContainText('separate');
  await page.screenshot({ path: testInfo.outputPath('step0-install.png'), fullPage: true });
  await page.getByTestId('continue-anyway').click();

  // Step 1: name and piece count.
  await expectStep(page, 1);
  const nameInput = page.getByTestId('puzzle-name-input');
  await expect(nameInput).toHaveValue('Puzzle 1');
  await expect(page.getByTestId('wizard-next')).toBeVisible();
  await page.getByTestId('count-1000').click();
  await expect(page.getByTestId('count-1000')).toHaveAttribute('aria-pressed', 'true');
  // The puzzle exists from the first answer: the address now carries its id.
  await expect(page).toHaveURL(/#\/new\/[\w-]+$/);
  await nameInput.fill('Lighthouse');
  await nameInput.blur();
  await page.screenshot({ path: testInfo.outputPath('step1-name.png'), fullPage: true });
  await page.getByTestId('wizard-next').click();

  // Step 2: box photo → corners → straightened picture.
  await expectStep(page, 2);
  const projectId = decodeURIComponent(page.url().split('#/new/')[1]!);
  await page.getByTestId('box-file-photos').setInputFiles({ name: 'box.jpg', mimeType: 'image/jpeg', buffer: boxPhoto() });
  const editor = page.getByTestId('corner-editor');
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('corner-handle-3')).toBeVisible();

  // The automatic guess put the top-left dot near the picture's top-left corner (not the default 12 % inset).
  const tl = await page.getByTestId('corner-handle-0').evaluate((el) => [Number(el.dataset.x), Number(el.dataset.y)]);
  testInfo.annotations.push({ type: 'auto-corner', description: tl.join(', ') });
  expect(Math.abs(tl[0]! - 0.12) + Math.abs(tl[1]! - 0.12)).toBeGreaterThan(0.02);

  // Drag a dot a little with the finger (mouse here): the magnifier appears, the dot follows, and comes back.
  const h1 = await page.getByTestId('corner-handle-1').boundingBox();
  const before = await page.getByTestId('corner-handle-1').getAttribute('data-x');
  await page.mouse.move(h1!.x + h1!.width / 2 + 20, h1!.y + h1!.height / 2 + 20);
  await page.mouse.down();
  await page.mouse.move(h1!.x + h1!.width / 2 + 10, h1!.y + h1!.height / 2 + 40, { steps: 4 });
  await expect(page.getByTestId('corner-loupe')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('step2-corners-drag.png'), fullPage: true });
  await page.mouse.move(h1!.x + h1!.width / 2 + 20, h1!.y + h1!.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('corner-loupe')).toHaveCount(0);
  expect(Number(await page.getByTestId('corner-handle-1').getAttribute('data-x'))).toBeCloseTo(Number(before), 2);

  // Reload in the middle of placing corners: the photo and the corners come back.
  await page.waitForTimeout(500); // corner changes are saved after a short pause
  const savedTl = await page.getByTestId('corner-handle-0').getAttribute('data-x');
  await page.reload();
  await expectStep(page, 2);
  await expect(page.getByTestId('corner-editor')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('corner-handle-0')).toHaveAttribute('data-x', savedTl!);

  await page.getByTestId('box-straighten').click();
  await expect(page.getByTestId('box-rectified')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('box-shape')).toContainText('taller than wide');
  await page.screenshot({ path: testInfo.outputPath('step2-rectified.png'), fullPage: true });

  // Reload: the wizard comes back on step 2 with the straightened picture.
  await page.reload();
  await expectStep(page, 2);
  await expect(page.getByTestId('box-rectified')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wizard-next').click();

  // Step 3: the grid from 1000 pieces and a portrait picture.
  await expectStep(page, 3);
  await expect(page.getByTestId('grid-chosen')).toContainText('28 across × 36 down');
  await expect(page.getByTestId('grid-chosen')).toContainText('1008 pieces');
  await page.screenshot({ path: testInfo.outputPath('step3-grid.png'), fullPage: true });
  await page.getByTestId('grid-option-27x37').click();
  await expect(page.getByTestId('grid-chosen')).toContainText('27 across × 37 down');
  await page.getByTestId('grid-manual-open').click();
  await page.getByTestId('grid-cols').fill('10');
  await page.getByTestId('grid-rows').fill('10');
  await page.getByTestId('grid-manual-use').click();
  await expect(page.getByTestId('step-error')).toContainText('far from');
  await page.getByTestId('grid-option-28x36').click();
  await expect(page.getByTestId('grid-chosen')).toContainText('28 across × 36 down');
  await page.getByTestId('wizard-next').click();

  // Step 4: no printing is offered first; this test takes the printed-markers route.
  await expectStep(page, 4);
  await expect(page.getByTestId('step-tracking')).toContainText('No printing needed');
  await page.getByText('I have a printer and want extra precision').click();
  await page.getByTestId('use-markers').click();
  await expect(page.getByTestId('wizard-next')).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('step4-markers.png'), fullPage: true });
  await page.getByTestId('open-marker-sheets').click();
  await expect(page.getByTestId('marker-sheets')).toBeVisible();
  await expect(page.locator('[data-testid="sheet-0"] svg rect.card')).toHaveCount(4);
  await expect(page.locator('[data-testid="sheet-1"] svg rect.card')).toHaveCount(4);
  await expect(page.getByTestId('sheet-1')).toContainText('Marker 7');
  await page.screenshot({ path: testInfo.outputPath('markers-page.png'), fullPage: true });
  // The page brings its own print rules: A4 with fixed margins, printed at 100 %.
  const printCss = await page.locator('[data-testid="marker-sheets"] style').textContent();
  expect(printCss).toMatch(/@page \{ size: A4/);
  await page.getByTestId('sheets-back').click();
  await expectStep(page, 4);

  await page.getByTestId('ruler-no').click();
  await page.getByTestId('ruler-mm').fill('300');
  await page.getByTestId('ruler-save').click();
  await expect(page.getByTestId('step-error')).toContainText('far from 100 mm');
  await page.getByTestId('ruler-mm').fill('97');
  await page.getByTestId('ruler-save').click();
  await expect(page.getByTestId('print-scale-saved')).toContainText('97 mm');
  expect(await readSetting(page, `printScale:${projectId}`)).toBeCloseTo(0.97, 6);
  await page.getByTestId('wizard-next').click();

  // Step 5 (lay out the markers; covered with a camera in table-setup.spec.ts); reloading comes back to it.
  await expectStep(page, 5);
  await expect(page.getByTestId('step-table')).toContainText('Lay out the markers');
  await page.reload();
  await expectStep(page, 5);
  await page.getByTestId('wizard-close').click();

  // Puzzle screen.
  await expect(page.getByTestId('puzzle-screen')).toBeVisible();
  await expect(page.getByTestId('puzzle-name')).toHaveText('Lighthouse');
  await expect(page.getByTestId('puzzle-count')).toHaveText('1000');
  await expect(page.getByTestId('puzzle-grid')).toContainText('28 across × 36 down');
  await expect(page.getByTestId('puzzle-box')).toBeVisible();
  await expect(page.getByTestId('continue-setup')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('puzzle-screen.png'), fullPage: true });

  // Export a backup and download it.
  await page.getByTestId('export-backup').click();
  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 30_000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-backup').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^Lighthouse \d{4}-\d\d-\d\d\.pfbackup$/);
  const backupPath = testInfo.outputPath('backup.pfbackup');
  await download.saveAs(backupPath);
  const backup = await readFile(backupPath);
  const files = unzipSync(new Uint8Array(backup));
  const manifest = JSON.parse(new TextDecoder().decode(files['backup.json']));
  expect(manifest).toMatchObject({ format: 'puzzle-lens-backup', version: 1, settings: { printScale: 0.97 } });
  expect(manifest.project).toMatchObject({ id: projectId, name: 'Lighthouse', pieceCount: 1000, grid: { cols: 28, rows: 36 }, setupStep: 5 });
  expect(manifest.blobs.map((b: { kind: string }) => b.kind).sort()).toEqual(['box-photo', 'box-rectified']);

  // Delete it.
  await page.getByTestId('delete-puzzle').click();
  await page.getByTestId('delete-confirm').click();
  await expect(page.getByTestId('your-puzzles')).toContainText('No puzzles yet');
  expect(await readSetting(page, `printScale:${projectId}`)).toBeNull();

  // Import the backup: the puzzle comes back whole.
  await page.getByTestId('import-file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/octet-stream', buffer: backup });
  await expect(page.getByTestId('import-done')).toContainText('restored');
  const card = page.getByTestId('puzzle-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Lighthouse');
  await expect(card).toContainText('1000 pieces · 28 × 36');
  await expect(card.locator('img')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home-list.png'), fullPage: true });
  await card.click();
  await expect(page.getByTestId('puzzle-box')).toBeVisible();
  await expect(page.getByTestId('puzzle-grid')).toContainText('28 across × 36 down');
  expect(await readSetting(page, `printScale:${projectId}`)).toBeCloseTo(0.97, 6);

  // Continue set-up resumes at step 5.
  await page.getByTestId('continue-setup').click();
  await expectStep(page, 5);

  // A file that isn't a backup is refused in words.
  await gotoScreen(page, '');
  await page.getByTestId('import-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByTestId('import-error')).toContainText("isn't a Puzzle Lens backup");
});

test('new puzzle in the Home Screen app starts at step 1 (no install advice)', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true }));
  await gotoScreen(page, '');
  await expect(page.getByTestId('install-banner')).toHaveCount(0);
  await page.getByTestId('new-puzzle').click();
  await expectStep(page, 1);
  // Back from step 1 before anything is typed goes home, leaving no puzzle behind.
  await page.getByTestId('wizard-back').click();
  await expect(page.getByTestId('your-puzzles')).toContainText('No puzzles yet');
});
