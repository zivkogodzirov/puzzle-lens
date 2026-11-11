import { test, expect, gotoScreen } from './fixtures';

test('home screen loads, shows the install banner in a Safari tab, and logs no errors', async ({ page, problems }) => {
  await gotoScreen(page, '');
  await expect(page).toHaveTitle('Puzzle Lens');
  await expect(page.getByRole('heading', { level: 1, name: 'Puzzle Lens' })).toBeVisible();

  // Not opened from the Home Screen, so the "install first" banner must show.
  const banner = page.getByTestId('install-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Install first');
  // iOS 26/27: Share may be behind "⋯" and "Add to Home Screen" under "View More".
  await expect(banner).toContainText('Add to Home Screen');
  await expect(banner).toContainText('View More');
  // A fresh start shows neither the crash warning nor a waiting memory result.
  await expect(page.getByTestId('crash-notice')).toHaveCount(0);
  await expect(page.getByTestId('memory-result-waiting')).toHaveCount(0);

  // The main tiles are there.
  for (const name of ['Live camera', 'Device check', 'Send report', 'How it works', 'Settings']) {
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  }
  await expect(page.getByText(/^Version \S+/)).toBeVisible();

  // Give start-up work (database, service worker registration, launch record) time to finish.
  await page.waitForTimeout(2000);
  expect(problems.consoleErrors, 'console errors on the home screen').toEqual([]);
});

test('no screen scrolls sideways, and the 🧪 button sits in the top bar, inside the content', async ({ page }) => {
  // 2026-11-10 app review: Device check scrolled sideways by 61 px (WebKit drew a bare hidden file
  // input's button past its 1 px box), and the 40 px 🧪 tab covered card edges and text on every screen.
  // M9 part 1: the 🧪 entry is a button in each screen's top bar (no edge tab there any more).
  for (const width of [375, 402, 430]) {
    await page.setViewportSize({ width, height: 800 });
    for (const screen of ['', 'device', 'help', 'settings', 'report', 'log'] as const) {
      await gotoScreen(page, screen);
      const m = await page.evaluate(() => {
        const main = document.querySelector('main.screen')!;
        const r = main.getBoundingClientRect();
        const contentRight = r.right - parseFloat(getComputedStyle(main).paddingRight);
        const entries = document.querySelectorAll('[data-testid=test-tab]');
        const tab = entries[0]!;
        const box = tab.getBoundingClientRect();
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          contentRight,
          entries: entries.length,
          inTopBar: Boolean(tab.closest('.topbar')),
          tabRight: box.right,
          tabWidth: box.width,
          tabHeight: box.height,
        };
      });
      const where = `#/${screen} at ${width} px`;
      expect(m.scrollWidth, `${where}: page width`).toBe(m.clientWidth);
      expect(m.entries, `${where}: one 🧪 entry`).toBe(1);
      expect(m.inTopBar, `${where}: 🧪 in the top bar`).toBe(true);
      expect(m.tabRight, `${where}: 🧪 inside the content`).toBeLessThanOrEqual(m.contentRight + 0.5);
      expect(Math.min(m.tabWidth, m.tabHeight), `${where}: 🧪 at least 44 px`).toBeGreaterThanOrEqual(44);
    }
  }
});
