import type { Page } from '@playwright/test';
import { test, expect, gotoScreen } from './fixtures';
import { showHud } from './live-helpers';

/** Waits until the service worker has installed (precache filled) and is active. */
async function waitForOfflineReady(page: Page): Promise<void> {
  const state = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        if (!('serviceWorker' in navigator)) return reject(new Error('No service worker support'));
        const timer = setTimeout(() => reject(new Error('The service worker did not become active within 45 s')), 45_000);
        void navigator.serviceWorker.ready.then((reg) => {
          const sw = reg.active;
          if (!sw) return;
          const done = () => {
            clearTimeout(timer);
            resolve(sw.state);
          };
          if (sw.state === 'activated') done();
          else sw.addEventListener('statechange', () => sw.state === 'activated' && done());
        });
      }),
  );
  expect(state).toBe('activated');
}

/** Proves the network really is off: a file that isn't in the offline cache can't be fetched. */
async function expectNetworkOff(page: Page): Promise<void> {
  const result = await page.evaluate(async () => {
    try {
      const r = await fetch(`/not-cached-${Date.now()}.txt`, { cache: 'no-store' });
      return `reached the server (HTTP ${r.status})`;
    } catch {
      return 'failed';
    }
  });
  expect(result, 'a request for an uncached file should fail while offline').toBe('failed');
}

test.describe('offline', () => {
  test.afterEach(async ({ context }) => {
    await context.setOffline(false);
  });

  test('after the first visit, the app opens with no network', async ({ page, context }) => {
    await gotoScreen(page, '');
    await waitForOfflineReady(page);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Puzzle Lens' })).toBeVisible();
    await expect(page.getByTestId('install-banner')).toBeVisible();
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'the page is served by the service worker').toBe(true);
    await expectNetworkOff(page);

    // The test marker picture is cached too (the guide tells you to open it on another screen).
    await page.goto('./#/help');
    await page.getByTestId('show-test-marker').click();
    await expect
      .poll(() => page.getByTestId('test-marker-img').evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0)))
      .toBeGreaterThan(0);
    const svg = await page.evaluate(async () => (await fetch('/puzzle-lens/test-marker.svg')).text());
    expect(svg).toContain('<svg');
  });

  test('offline, the live camera still loads OpenCV and finds the marker', async ({ page, context }) => {
    await gotoScreen(page, '');
    await waitForOfflineReady(page);
    await context.setOffline(true);
    // Reload so the page (and the workers it starts) are served by the service worker.
    await page.reload();
    await expect(page.getByTestId('install-banner')).toBeVisible();
    await expectNetworkOff(page);
    await page.goto('./#/live');
    await showHud(page);
    await page.getByTestId('start-camera').click();
    await expect
      .poll(async () => Number((await page.getByTestId('markers-seen').textContent()) ?? 0), {
        message: 'tracker worker + OpenCV WASM should load from the offline cache',
        timeout: 25_000,
      })
      .toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('hud')).not.toContainText('⚠');
  });
});
