import { test, expect, gotoScreen } from './fixtures';

test('help: "Show test marker" shows the marker picture full screen, and a tap closes it', async ({ page }) => {
  await gotoScreen(page, 'help');
  await expect(page.getByTestId('help-screen')).toBeVisible();
  await expect(page.getByTestId('install-status')).toBeVisible();
  // The guide uses the exact button names from the Send report screen, and explains "gap" on the HUD.
  await expect(page.getByTestId('help-report')).toContainText('Prepare report');
  await expect(page.getByTestId('help-report')).toContainText('Share report');
  await expect(page.getByTestId('hud-explained')).toContainText('Gap is the longest pause');

  await page.getByTestId('show-test-marker').click();
  const overlay = page.getByTestId('test-marker-overlay');
  await expect(overlay).toBeVisible();
  const img = page.getByTestId('test-marker-img');
  await expect(img).toHaveAttribute('src', '/puzzle-lens/test-marker.svg');
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0)), { message: 'the marker SVG should load' })
    .toBeGreaterThan(0);
  // Big enough to be seen by the camera from across a table.
  const box = await img.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(300);

  await overlay.click();
  await expect(overlay).toBeHidden();
});
