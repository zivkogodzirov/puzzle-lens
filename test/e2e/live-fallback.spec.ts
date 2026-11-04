/**
 * The fallback frame path (PLAN §3.1 item 2): when the camera track can't be handed to the
 * tracker worker (iPhones before iOS 18), the main thread sends small ImageBitmaps instead.
 * The simulated camera's clone is made un-sendable to force this path.
 */
import { test, expect, fakeCameraStats, gotoScreen } from './fixtures';
import { hudNumber, startLiveCamera } from './live-helpers';

test.use({ fakeCameraOptions: { directFrames: false } });

test('fallback frames: the tracker still gets frames and finds the marker', async ({ page }, testInfo) => {
  await startLiveCamera(page);
  const hud = page.getByTestId('hud');
  await expect(hud).toContainText('copied (fallback)', { timeout: 15_000 });
  await expect.poll(() => hudNumber(page, 'tracker-fps'), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => hudNumber(page, 'markers-seen'), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  const hudText = (await hud.innerText()).replace(/\n/g, ' | ');
  testInfo.annotations.push({ type: 'hud (fallback)', description: hudText });
  console.log(`[live/fallback] HUD: ${hudText}`);
});

test('fallback frames: leaving the Live screen and coming back works without errors', async ({ page, problems }) => {
  // Regression test: stopPump() used to call cancelVideoFrameCallback without its `this`, so
  // WebKit threw, the pump never stopped and the camera stayed on.
  await startLiveCamera(page);
  await expect(page.getByTestId('hud')).toContainText('copied (fallback)', { timeout: 15_000 });
  // The un-sendable clone was refused by the worker and must already be stopped.
  expect((await fakeCameraStats(page)).liveClones, 'clones left running').toBe(0);

  await page.getByRole('button', { name: '‹ Home' }).click();
  await expect(page.getByTestId('install-banner')).toBeVisible();
  await page.waitForTimeout(500);
  expect(problems.pageErrors, 'uncaught errors when leaving the Live screen').toEqual([]);
  const stats = await fakeCameraStats(page);
  expect(stats.liveCameraTracks, 'camera tracks left running after leaving Live').toBe(0);
  expect(stats.liveClones).toBe(0);

  // Back to Live: the camera and the tracker must start again.
  await startLiveCamera(page);
  await expect(page.getByTestId('hud')).toContainText('copied (fallback)', { timeout: 15_000 });
  await expect.poll(() => hudNumber(page, 'tracker-fps'), { timeout: 15_000 }).toBeGreaterThan(0);
  expect(problems.pageErrors).toEqual([]);
});

test('fallback frames: leaving with the browser Back gesture also turns the camera off', async ({ page, problems }) => {
  // Home first, then Live by a hash change, so "Back" returns to Home (like Safari's back swipe).
  await gotoScreen(page, '');
  await page.evaluate(() => {
    location.hash = '#/live';
  });
  await page.getByTestId('start-camera').click();
  await expect(page.getByTestId('hud')).toContainText('copied (fallback)', { timeout: 15_000 });
  await page.goBack(); // a hash change, not the ‹ Home button
  await expect(page.getByTestId('live-video')).toBeHidden();
  await page.waitForTimeout(500);
  expect(problems.pageErrors).toEqual([]);
  expect((await fakeCameraStats(page)).liveCameraTracks, 'camera tracks left running').toBe(0);
});
