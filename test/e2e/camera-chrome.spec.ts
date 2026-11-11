/**
 * M9 part 2 (round 2): the camera screens' chrome. The top rows' buttons are camera-style icon buttons
 * (a white icon on the dark camera material, 36 px in a 44 px hit area) with names VoiceOver reads; Back
 * goes to the screen the camera was opened from; the 🧪 button is the flask icon; nothing scrolls sideways
 * on a 375 or 402 px wide iPhone. The live view's piece box is checked in live-view.spec.ts.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect, gotoScreen } from './fixtures';

const WIDTHS = [
  { width: 375, height: 667 },
  { width: 402, height: 874 },
];

/** A button whose name VoiceOver reads, with the icon `icon` (hidden from VoiceOver) and a 44 × 44 px target. */
async function iconButton(button: Locator, icon: string): Promise<void> {
  await expect(button).toBeVisible();
  await expect(button.locator(`svg[data-icon="${icon}"]`)).toHaveCount(1);
  await expect(button.locator(`svg[data-icon="${icon}"]`)).toHaveAttribute('aria-hidden', 'true');
  const box = (await button.boundingBox())!;
  expect(Math.min(box.width, box.height), `${await button.getAttribute('aria-label')}: at least 44 px`).toBeGreaterThanOrEqual(44);
}

async function noSidewaysScroll(page: Page, where: string): Promise<void> {
  const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(m.scroll, `${where}: no sideways scroll`).toBeLessThanOrEqual(m.client);
}

/** Every visible button in the camera's top row is at least 44 × 44 px. */
async function topRowTargets(page: Page, where: string): Promise<void> {
  const buttons = page.locator('.live-top button:visible');
  const n = await buttons.count();
  expect(n, `${where}: buttons in the top row`).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const b = (await buttons.nth(i).boundingBox())!;
    expect(Math.min(b.width, b.height), `${where}: top-row button ${i} at least 44 px`).toBeGreaterThanOrEqual(44);
  }
}

async function seedPuzzle(page: Page, id: string, markers: boolean): Promise<void> {
  await gotoScreen(page, '');
  await page.evaluate(
    async ({ pid, markers }) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({
          id: pid,
          name: 'Harbour',
          createdAt: 1,
          updatedAt: 2,
          pieceCount: 48,
          grid: { cols: 8, rows: 6, source: 'suggested' },
          box: null,
          markerMap: null,
          tableModel: null,
          piecePitch: null,
          setupStep: markers ? 4 : 6,
          tracking: markers ? 'markers' : 'pieces',
        });
        tx.oncomplete = () => res();
      });
      dbh.close();
    },
    { pid: id, markers },
  );
}

for (const size of WIDTHS) {
  test.describe(`camera chrome at ${size.width} px`, () => {
    test.use({ viewport: size });

    test('Live camera: icon buttons with names; the performance display toggles; Back goes Home', async ({ page }) => {
      await gotoScreen(page, 'live');
      const back = page.getByRole('button', { name: 'Back to Home' });
      await iconButton(back, 'chevron-left');
      const hud = page.getByRole('button', { name: 'Performance display' });
      await iconButton(hud, 'activity');
      await iconButton(page.getByTestId('test-tab'), 'flask-conical');
      await expect(page.getByTestId('test-tab')).toHaveAccessibleName(/What to test/);
      await topRowTargets(page, 'live');
      await noSidewaysScroll(page, 'live');

      const was = await hud.getAttribute('aria-pressed');
      await hud.click();
      await expect(hud).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true');

      await page.getByTestId('start-camera').click();
      await expect.poll(() => page.getByTestId('live-video').evaluate((v: HTMLVideoElement) => !v.paused && v.videoWidth > 0), { timeout: 15_000 }).toBe(true);
      await topRowTargets(page, 'live, camera on');
      await noSidewaysScroll(page, 'live, camera on');
      await back.click();
      await expect(page.locator('#app > .app.route-home')).toBeAttached();
    });

    test('scan camera: Back is an icon button that goes to the puzzle page; zoom, the gear and 🧪 in the row; Photos has its icon', async ({ page }) => {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      });
      await seedPuzzle(page, 'chrome-scan', false);
      await page.evaluate(() => (location.hash = '#/puzzle/chrome-scan'));
      await page.getByTestId('scan-pieces').click();
      await expect(page.getByTestId('table-camera')).toBeVisible();
      const back = page.getByTestId('camera-close');
      await expect(back).toHaveAccessibleName('Back');
      await iconButton(back, 'chevron-left');
      await expect(page.getByTestId('camera-zoom')).toHaveAccessibleName(/Zoom [12]×/);
      await iconButton(page.getByTestId('test-tab'), 'flask-conical');
      await expect(page.getByTestId('test-tab')).toHaveCount(1);
      // M9 part 5: Photos is a 50 px icon button in the dock, its name read by VoiceOver; the gear is in the top row.
      await iconButton(page.getByTestId('pick-photo'), 'image');
      await expect(page.getByTestId('pick-photo')).toHaveAccessibleName(/Choose a photo/);
      await iconButton(page.getByTestId('camera-settings'), 'settings');
      await expect(page.getByTestId('camera-settings')).toHaveAccessibleName('Coin and help');
      await topRowTargets(page, 'scan');
      await noSidewaysScroll(page, 'scan');
      await back.click();
      await expect(page).toHaveURL(/#\/puzzle\/chrome-scan$/);
    });

    test('Scan before the markers are set up: the top bar goes back to the puzzle page', async ({ page }) => {
      await seedPuzzle(page, 'chrome-setup', true);
      await page.evaluate(() => (location.hash = '#/scan/chrome-setup'));
      await expect(page.getByTestId('scan-needs-setup')).toBeVisible();
      const back = page.getByTestId('navbar-back');
      await expect(back).toHaveAccessibleName('Back to Harbour');
      await noSidewaysScroll(page, 'scan, set-up missing');
      await back.click();
      await expect(page).toHaveURL(/#\/puzzle\/chrome-setup$/);
    });

    test('a puzzle that is not on this iPhone: a red callout and a way Home', async ({ page }) => {
      await gotoScreen(page, '');
      await page.evaluate(() => (location.hash = '#/scan/not-here'));
      await expect(page.getByTestId('scan-missing')).toBeVisible();
      await expect(page.locator('.callout.callout-bad[role=alert]')).toContainText('not on this iPhone');
      await noSidewaysScroll(page, 'scan, missing');
      await page.getByTestId('navbar-back').click();
      await expect(page.locator('#app > .app.route-home')).toBeAttached();
    });
  });
}
