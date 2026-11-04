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
  for (const name of ['Live camera', 'Device check', 'Send report', 'Setup guide', 'Settings']) {
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  }
  await expect(page.getByText(/^Version \S+/)).toBeVisible();

  // Give start-up work (database, service worker registration, launch record) time to finish.
  await page.waitForTimeout(2000);
  expect(problems.consoleErrors, 'console errors on the home screen').toEqual([]);
});
