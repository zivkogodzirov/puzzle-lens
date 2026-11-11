/**
 * M9 part 1 in WebKit: the Tester mode switch (Settings, design plan §2.8 and quick win 10). On (the
 * default, while the owner tests each milestone): the testing tools, the 🧪 test steps and the
 * developer numbers show. Off: they are hidden; nothing else changes. The 🧪 entry is a button in
 * the top bar, and in the camera screens' own top row, so the steps open from every screen.
 */
import type { Page } from '@playwright/test';
import { generatePuzzle, renderScene } from '../synth/index';
import type { SceneOptions } from '../synth/types';
import { test, expect, gotoScreen } from './fixtures';

const W = 4032;
const H = 3024;
let overview = '';
let moved = '';

test.beforeAll(async () => {
  const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 12 });
  const base: SceneOptions = {
    puzzle,
    seed: 44,
    markers: [],
    layout: { areaMm: [600, 450], originMm: [100, 80] },
    camera: { x: 400, y: 305, heightMm: 680, tiltDeg: 1, imageSize: [W, H] },
    light: { dirDeg: 200 },
  };
  overview = `data:image/jpeg;base64,${(await renderScene(base)).jpeg.toString('base64')}`;
  const m = await renderScene({ ...base, camera: { x: 440, y: 290, heightMm: 640, tiltDeg: 4, tiltDirDeg: 60, yawDeg: 20, imageSize: [W, H] } });
  moved = `data:image/jpeg;base64,${m.jpeg.toString('base64')}`;
});

/** A set-up puzzle without pieces yet. */
async function addPuzzle(page: Page, id: string): Promise<void> {
  await page.evaluate(async (pid) => {
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    await new Promise<void>((res) => {
      const tx = dbh.transaction('projects', 'readwrite');
      tx.objectStore('projects').put({
        id: pid,
        name: 'Tester mode',
        createdAt: 1,
        updatedAt: 2,
        pieceCount: 48,
        grid: { cols: 8, rows: 6, source: 'suggested' },
        box: null,
        markerMap: null,
        tableModel: null,
        piecePitch: null,
        setupStep: 6,
        tracking: 'pieces',
      });
      tx.oncomplete = () => res();
    });
    dbh.close();
  }, id);
}

async function setTester(page: Page, on: boolean): Promise<void> {
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.getByTestId(on ? 'tester-on' : 'tester-off').click();
  await expect(page.getByTestId(on ? 'tester-on' : 'tester-off')).toHaveAttribute('aria-pressed', 'true');
}

/** The one 🧪 entry on screen opens the steps, which close again. */
async function opensSteps(page: Page, where: string): Promise<void> {
  const entry = page.getByTestId('test-tab');
  await expect(entry, `${where}: one 🧪 entry`).toHaveCount(1);
  await expect(entry, where).toBeVisible();
  await entry.click();
  await expect(page.getByTestId('test-sheet'), where).toBeVisible();
  await page.getByTestId('test-close').click();
  await expect(page.getByTestId('test-sheet')).toHaveCount(0);
}

test.describe('Tester mode', () => {
  test.use({ persistentStorage: true });

  test('on by default: the tools and 🧪 show; off hides them (and stays off); on brings them back', async ({ page }) => {
    await gotoScreen(page, '');
    for (const id of ['tool-live', 'tool-device', 'tool-report', 'tool-log']) await expect(page.getByTestId(id), id).toBeVisible();
    await expect(page.locator('.topbar [data-testid=test-tab]')).toBeVisible();
    await expect(page.getByTestId('test-tab-new')).toBeVisible();

    await gotoScreen(page, 'settings');
    await expect(page.getByTestId('tester-on')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Performance display' })).toBeVisible();

    await setTester(page, false);
    await expect(page.getByTestId('test-tab')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Performance display' })).toHaveCount(0);
    await expect(page.getByTestId('tester-explained')).toContainText('hidden');
    await page.reload();
    await expect(page.getByTestId('tester-off')).toHaveAttribute('aria-pressed', 'true');
    await gotoScreen(page, '');
    for (const id of ['tool-live', 'tool-device', 'tool-report', 'tool-log']) await expect(page.getByTestId(id), id).toHaveCount(0);
    for (const name of ['How it works', 'Settings']) await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByTestId('test-tab')).toHaveCount(0);
    // The Live camera screen (still reachable by its address) has no HUD button.
    await gotoScreen(page, 'live');
    await expect(page.getByRole('button', { name: 'HUD' })).toHaveCount(0);
    await expect(page.getByTestId('test-tab')).toHaveCount(0);

    await setTester(page, true);
    await gotoScreen(page, '');
    await expect(page.getByTestId('tool-live')).toBeVisible();
    await expect(page.getByTestId('test-tab')).toBeVisible();
  });

  test('🧪 opens the steps from Home, a puzzle page, the scan camera and the Live camera; none with Tester mode off', async ({ page }) => {
    await gotoScreen(page, '');
    await addPuzzle(page, 'e2e-tester-steps');
    await opensSteps(page, 'Home');
    await page.evaluate(() => (location.hash = '#/puzzle/e2e-tester-steps'));
    await expect(page.getByTestId('scan-pieces')).toBeVisible();
    await expect(page.locator('.topbar [data-testid=test-tab]')).toBeVisible();
    await opensSteps(page, 'puzzle page');

    await page.getByTestId('scan-pieces').click();
    await expect(page.getByTestId('table-camera')).toBeVisible();
    await expect(page.locator('.table-camera .live-top [data-testid=test-tab]')).toBeVisible();
    await opensSteps(page, 'scan camera');
    await page.getByTestId('camera-close').click();
    // Back on the puzzle page: its own top bar button again.
    await expect(page.locator('.topbar [data-testid=test-tab]')).toBeVisible();

    // The Live camera screen, before and after the camera starts (its top row stays above "Start camera").
    await gotoScreen(page, 'live');
    await expect(page.locator('.live-top [data-testid=test-tab]')).toBeVisible();
    await opensSteps(page, 'Live camera');
    await page.getByTestId('start-camera').click();
    await opensSteps(page, 'Live camera, camera on');

    await setTester(page, false);
    await page.evaluate(() => (location.hash = '#/puzzle/e2e-tester-steps'));
    await expect(page.getByTestId('scan-pieces')).toBeVisible();
    await expect(page.getByTestId('test-tab')).toHaveCount(0);
    await page.getByTestId('scan-pieces').click();
    await expect(page.getByTestId('table-camera')).toBeVisible();
    await expect(page.getByTestId('test-tab')).toHaveCount(0);
  });
});

test.describe('developer numbers only in Tester mode', () => {
  test.use({ fakeCameraOptions: { width: W, height: H, fps: 8 }, persistentStorage: true });
  test.setTimeout(300_000);

  test('the gauge’s height and tilt, and the live view’s "/s"; 🧪 in the live view', async ({ page }) => {
    await page.addInitScript((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), overview);
    await gotoScreen(page, '');
    await addPuzzle(page, 'e2e-tester-numbers');
    await page.evaluate(() => (location.hash = '#/puzzle/e2e-tester-numbers'));
    await page.getByTestId('scan-pieces').click();
    await page.getByTestId('allow-tilt').click();
    // Tilted, so no photo takes itself while the gauge is checked.
    await page.evaluate(() => {
      const w = window as unknown as { __beta: number };
      w.__beta = 20;
      setInterval(() => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: w.__beta, gamma: -1 })), 50);
    });
    await expect(page.locator('.gauge-sub')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.gauge-sub')).toContainText(/\d+ cm high · tilt \d+°/);

    await setTester(page, false);
    await page.evaluate(() => (location.hash = '#/scan/e2e-tester-numbers'));
    await expect(page.getByTestId('level-gauge')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.gauge-msg')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.locator('.gauge-sub')).toHaveCount(0);

    // Level: the overview photo takes itself.
    await page.evaluate(() => ((window as unknown as { __beta: number }).__beta = 1));
    await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
    await expect(page.getByTestId('scan-count')).toContainText(/^\d+ pieces? found$/);

    // The live view: the tracking line without "/s" while Tester mode is off, with it when on.
    await page.evaluate((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), moved);
    await page.evaluate(() => (location.hash = '#/puzzle/e2e-tester-numbers'));
    await page.getByTestId('live-toggle').click();
    const status = page.getByTestId('live-status');
    await expect(status).toHaveAttribute('data-kind', 'good', { timeout: 60_000 });
    await page.waitForTimeout(2000);
    await expect(status).toContainText('Tracking ✓');
    await expect(status).not.toContainText('/s');
    await expect(page.locator('.live-rate')).toHaveCount(0);
    await expect(page.getByTestId('test-tab')).toHaveCount(0);
    await page.getByTestId('live-table-close').click();

    await setTester(page, true);
    await page.evaluate(() => (location.hash = '#/puzzle/e2e-tester-numbers'));
    await page.getByTestId('live-toggle').click();
    await expect(status).toHaveAttribute('data-kind', 'good', { timeout: 60_000 });
    await expect(page.locator('.live-rate')).toContainText(/\d+\/s/, { timeout: 10_000 });
    // 🧪 in the live view's own top row (over the puzzle page's).
    await expect(page.locator('.live-table .live-top [data-testid=test-tab]')).toBeVisible();
    await opensSteps(page, 'live view');
    await page.getByTestId('live-table-close').click();
    await expect(page.locator('.topbar [data-testid=test-tab]')).toBeVisible();
  });
});
